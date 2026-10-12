"use client";

import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { ReactRenderer, type Editor } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type MenuItem = {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  group?: string;
};

export type MenuHandle = { onKeyDown: (p: SuggestionKeyDownProps) => boolean };

type MenuProps = { items: MenuItem[]; command: (item: MenuItem) => void; empty?: string };

export const SuggestionMenu = forwardRef<MenuHandle, MenuProps>(function SuggestionMenu({ items, command, empty = "No results" }, ref) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") { setIndex((i) => (i + 1) % items.length); return true; }
      if (event.key === "ArrowUp") { setIndex((i) => (i - 1 + items.length) % items.length); return true; }
      if (event.key === "Enter" || event.key === "Tab") { command(items[index]); return true; }
      return false;
    },
  }));

  let lastGroup: string | undefined;
  return (
    <div ref={listRef} role="listbox" className="max-h-80 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
      {items.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">{empty}</div>}
      {items.map((item, i) => {
        const header = item.group && item.group !== lastGroup ? item.group : null;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {header && <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{header}</div>}
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              data-index={i}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => { e.preventDefault(); command(item); }}
              className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm", i === index && "bg-accent")}
            >
              {item.icon && <span className="flex size-8 flex-none items-center justify-center rounded-md border bg-background text-base">{item.icon}</span>}
              <span className="min-w-0">
                <span className="block truncate">{item.title}</span>
                {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

/** Glue between Tiptap's Suggestion plugin and a floating React menu. */
export function suggestionRenderer<I extends MenuItem>(empty?: string, opts: { hideWhenEmpty?: boolean } = {}) {
  return () => {
    let component: ReactRenderer<MenuHandle, MenuProps> | null = null;
    let el: HTMLDivElement | null = null;

    const place = (props: SuggestionProps<I>) => {
      const rect = props.clientRect?.();
      if (!rect || !el) return;
      el.style.display = opts.hideWhenEmpty && props.items.length === 0 ? "none" : "";
      const virtual = { getBoundingClientRect: () => rect };
      computePosition(virtual, el, { placement: "bottom-start", middleware: [offset(6), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
        if (el) Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
      });
    };

    return {
      onStart: (props: SuggestionProps<I>) => {
        el = document.createElement("div");
        el.style.position = "fixed";
        el.style.zIndex = "60";
        document.body.appendChild(el);
        component = new ReactRenderer(SuggestionMenu, { props: { items: props.items, command: props.command, empty }, editor: props.editor as Editor });
        el.appendChild(component.element);
        place(props);
      },
      onUpdate: (props: SuggestionProps<I>) => {
        component?.updateProps({ items: props.items, command: props.command, empty });
        place(props);
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === "Escape") {
          el?.remove();
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        component?.destroy();
        el?.remove();
        component = null;
        el = null;
      },
    };
  };
}
