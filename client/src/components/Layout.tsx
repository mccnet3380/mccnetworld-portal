import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopNavigation } from './TopNavigation';

interface LayoutProps {
  children: React.ReactNode;
  title: string;
  showSidebar?: boolean;
}

export function Layout({ children, title, showSidebar = true }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-gray-100">
      {showSidebar && <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />}
      
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopNavigation title={title} onMenuClick={showSidebar ? () => setSidebarOpen(true) : undefined} />
        
        <main className="flex-1 relative overflow-y-auto overflow-x-auto focus:outline-none">
          <div className="py-6">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
