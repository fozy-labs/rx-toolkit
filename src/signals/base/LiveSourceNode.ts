import { addDependency, assertWriteAllowed, bumpVersion, Producer, writeProducer } from "./core";

/**
 * A per-part source of a larger value (a key of a keyed collection, a path of
 * a proxy state). Its owner writes it inside a batch; `peekLive` reads the
 * part from the owner, so a node the owner stopped writing (released, then
 * recreated) still validates an unobserved computed that holds a link to it.
 */
export class LiveSourceNode<V> extends Producer {
    constructor(
        private _value: V,
        private readonly _peekLive: () => V,
        private readonly _onIdle: () => void,
    ) {
        super();
    }

    /** Whether a computed, an effect or a watcher observes the node. */
    get observed(): boolean {
        return this._targets !== undefined;
    }

    /** Reactive read: tracks this node in the current tracking context. */
    read(): V {
        const link = addDependency(this);
        if (link !== undefined) link._version = this._version;
        return this._value;
    }

    /** Pushes a new value to observers. Runs inside the owner's batch. */
    notify(value: V): void {
        if (Object.is(value, this._value)) return;
        assertWriteAllowed();
        this._value = value;
        writeProducer(this);
    }

    override _refresh(): boolean {
        const live = this._peekLive();
        if (!Object.is(live, this._value)) {
            this._value = live;
            bumpVersion(this);
        }
        return true;
    }

    override _onUnobserved(): void {
        this._onIdle();
    }
}
