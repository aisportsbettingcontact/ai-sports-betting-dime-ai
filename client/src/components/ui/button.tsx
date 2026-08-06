import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* Audit DIME-UI-006 (2026-07-31): every variant carries press feedback
 * (motion-safe active scale), a hover treatment, and the brand motion pair
 * (160ms cubic-bezier(0.16,1,0.3,1)) instead of Tailwind's default
 * transition-all. Ghost/outline hovers use the quiet secondary fill — the old
 * hover:bg-accent flooded them mint, and mint is rationed to signal. Two
 * malformed dangling `dark:` fragments removed. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-[color,background-color,border-color,opacity,box-shadow,transform] duration-[160ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-safe:active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-[3px] aria-invalid:ring-destructive dark:aria-invalid:ring-destructive aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-85",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive dark:focus-visible:ring-destructive dark:bg-destructive hover:opacity-85",
        outline:
          "border bg-transparent shadow-xs hover:bg-secondary dark:bg-transparent dark:border-input",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-85",
        ghost: "hover:bg-secondary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (props.type ?? "button")}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
