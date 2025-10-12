export class PromiseResolver<T> {
    private _resolve!: (value: T) => void;
    private _reject!: (reason?: any) => void;

    promise: Promise<T> = new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
    });

    resolve(value: T): void {
        this._resolve(value);
    }

    reject(reason?: any): void {
        this._reject(reason);
    }
}
