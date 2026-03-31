interface SpinnerProps {
    className?: string;
}

export function Spinner({ className = '' }: SpinnerProps) {
    return (
        <div className={`flex items-center justify-center p-8 ${className}`}>
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500" />
        </div>
    );
}
