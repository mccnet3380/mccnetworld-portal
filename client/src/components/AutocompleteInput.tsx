import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Loader2, Search } from 'lucide-react';

interface AutocompleteOption {
  id: string | number;
  name: string;
}

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (option: AutocompleteOption) => void;
  fetchOptions: (query: string) => Promise<AutocompleteOption[]>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function AutocompleteInput({
  value,
  onChange,
  onSelect,
  fetchOptions,
  placeholder = '검색...',
  disabled = false,
  className,
  'data-testid': testId
}: AutocompleteInputProps) {
  const [options, setOptions] = useState<AutocompleteOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [justSelected, setJustSelected] = useState(false);
  
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (justSelected) {
      setJustSelected(false);
      return;
    }
    
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = await fetchOptions(value);
        setOptions(results);
        setShowDropdown(results.length > 0);
        setHighlightedIndex(-1);
      } catch (error) {
        console.error('Autocomplete fetch error:', error);
        setOptions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    setDebounceTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    if (highlightedIndex >= 0 && dropdownRef.current) {
      const highlightedElement = dropdownRef.current.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex]);

  const handleInputChange = (newValue: string) => {
    onChange(newValue);
  };

  const handleSelectOption = (option: AutocompleteOption) => {
    if (isSelectingRef.current) {
      return;
    }
    
    isSelectingRef.current = true;
    setJustSelected(true);
    setShowDropdown(false);
    setHighlightedIndex(-1);
    setOptions([]);
    onSelect(option);
    
    setTimeout(() => {
      isSelectingRef.current = false;
    }, 100);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || options.length === 0) {
      if (e.key === 'Escape') {
        setShowDropdown(false);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => 
          prev < options.length - 1 ? prev + 1 : prev
        );
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          handleSelectOption(options[highlightedIndex]);
        }
        break;
      
      case 'Escape':
        e.preventDefault();
        setShowDropdown(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (options.length > 0 && !showDropdown) {
              setShowDropdown(true);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={cn('pr-10', className)}
          data-testid={testId}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls="autocomplete-options"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          ) : (
            <Search className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>

      {showDropdown && options.length > 0 && (
        <div
          ref={dropdownRef}
          id="autocomplete-options"
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {options.map((option, index) => (
            <div
              key={option.id}
              role="option"
              aria-selected={highlightedIndex === index}
              className={cn(
                'px-3 py-2 cursor-pointer transition-colors',
                highlightedIndex === index
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50',
                'text-sm'
              )}
              onClick={() => handleSelectOption(option)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {option.name}
            </div>
          ))}
        </div>
      )}

      {showDropdown && !isLoading && value && options.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2">
          <p className="text-sm text-gray-500">검색 결과가 없습니다</p>
        </div>
      )}
    </div>
  );
}
