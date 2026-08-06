/**
 * MobileDataState — Unified data state wrapper for the mobile screens.
 * Handles loading/empty/error states with consistent UX.
 */
import { MobileLoadingState } from "./MobileLoadingState";
import { MobileEmptyState } from "./MobileEmptyState";
import { MobileErrorState } from "./MobileErrorState";

interface MobileDataStateProps {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  loadingLabel?: string;
  emptyMessage?: string;
  errorMessage?: string;
  emptyIcon?: React.ComponentType<{ className?: string }>;
  onRetry?: () => void;
  children: React.ReactNode;
}

export function MobileDataState({
  isLoading,
  isError,
  isEmpty,
  loadingLabel,
  emptyMessage,
  errorMessage,
  emptyIcon,
  onRetry,
  children,
}: MobileDataStateProps) {
  if (isLoading) return <MobileLoadingState label={loadingLabel} />;
  if (isError)
    return <MobileErrorState message={errorMessage} onRetry={onRetry} />;
  if (isEmpty)
    return <MobileEmptyState message={emptyMessage} icon={emptyIcon} />;
  return <>{children}</>;
}
