import React from "react";
import {
  LogOut,
  Check,
  ChevronDown,
  X,
  SquarePen,
  Home,
  Search,
  Plus,
  Settings,
  PanelLeftClose,
  UserPlus,
  Sparkles,
} from "lucide-react";

export function IconArrowBoxLeft({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <LogOut size={size} className={className} />;
}

export function IconCheckmark1Small({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <Check size={size} className={className} />;
}

export function IconChevronDownSmall({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <ChevronDown size={size} className={className} />;
}

export function IconCrossSmall({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <X size={size} className={className} />;
}

export function IconEditBig({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <SquarePen size={size} className={className} />;
}

export function IconHome({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <Home size={size} className={className} />;
}

export function IconMagnifyingGlass({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <Search size={size} className={className} />;
}

export function IconPlusMedium({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <Plus size={size} className={className} />;
}

export function IconPopsicle2({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <Sparkles size={size} className={className} />;
}

export function IconSettingsGear1({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <Settings size={size} className={className} />;
}

export function IconSidebarLeftArrow({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <PanelLeftClose size={size} className={className} />;
}

export function IconUserAdd({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <UserPlus size={size} className={className} />;
}
