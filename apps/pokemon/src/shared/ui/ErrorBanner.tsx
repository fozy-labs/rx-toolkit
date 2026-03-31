interface ErrorBannerProps {
    error: unknown;
    onRetry?: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
    return (
        <div className="rounded-lg bg-red-50 p-4 text-red-700">
            <p className="font-medium">Something went wrong</p>
            <p className="mt-1 text-sm">{error instanceof Error ? error.message : String(error)}</p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-2 rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
                >
                    Retry
                </button>
            )}
        </div>
    );
}
