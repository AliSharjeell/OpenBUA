import React, { useRef, useState, type CSSProperties, type ReactNode } from "react";

interface GlideMenuProps {
  children: ReactNode;
  rowSelector?: string;
  highlightClassName?: string;
  className?: string;
}

export default function GlideMenu({
  children,
  rowSelector = "[data-row]",
  highlightClassName = "sidebar-glide-highlight rounded-[7px] bg-hover-2",
  className = "",
}: GlideMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightStyle, setHighlightStyle] = useState<CSSProperties>({
    opacity: 0,
    pointerEvents: "none",
  });

  const updateHighlight = (target: HTMLElement | null) => {
    if (!target || !containerRef.current) {
      setHighlightStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const containerRect = containerRef.current.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    setHighlightStyle({
      top: targetRect.top - containerRect.top,
      left: targetRect.left - containerRect.left,
      width: targetRect.width,
      height: targetRect.height,
      opacity: 1,
      pointerEvents: "none",
    });
  };

  const handlePointerOver = (e: React.PointerEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(rowSelector);
    if (target && containerRef.current?.contains(target)) {
      updateHighlight(target);
    }
  };

  const handlePointerLeave = () => {
    setHighlightStyle((prev) => ({ ...prev, opacity: 0 }));
  };

  return (
    <div
      ref={containerRef}
      onPointerOver={handlePointerOver}
      onPointerLeave={handlePointerLeave}
      className={`relative ${className}`}
    >
      <div
        aria-hidden="true"
        className={`absolute transition-[top,left,width,height,opacity] duration-150 ease-out ${highlightClassName}`}
        style={highlightStyle}
      />
      {children}
    </div>
  );
}
