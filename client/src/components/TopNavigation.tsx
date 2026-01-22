import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Menu, LogOut, User } from 'lucide-react';

interface TopNavigationProps {
  title: string;
  onMenuClick: () => void;
}

export function TopNavigation({ title, onMenuClick }: TopNavigationProps) {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="relative z-10 flex-shrink-0 flex h-16 bg-white shadow">
      {/* Mobile menu button */}
      <button
        type="button"
        className="px-4 border-r border-gray-200 text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent md:hidden"
        onClick={onMenuClick}
      >
        <Menu className="h-6 w-6" />
      </button>
      
      <div className="flex-1 px-4 flex justify-between items-center">
        <div className="flex-1 flex">
          <h2 className="text-2xl font-semibold text-gray-900">{title}</h2>
        </div>
        
        <div className="ml-4 flex items-center md:ml-6">
          {/* User info */}
          <div className="flex items-center">
            {user?.dealerName && (
              <span className="text-sm text-gray-500 mr-4">{user.dealerName}</span>
            )}
            <span className="text-sm font-medium text-gray-900 mr-4">{user?.name}</span>
          </div>
          
          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="p-1 rounded-full">
                <User className="h-6 w-6 text-gray-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
