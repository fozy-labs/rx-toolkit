import { reduxDevtools } from './reduxDevtools';

function createMockExtension() {
  const connection = {
    init: vi.fn(),
    send: vi.fn(),
  };
  const extension = {
    connect: vi.fn(() => connection),
  };
  return { extension, connection };
}

describe('reduxDevtools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('initialization', () => {
    it('throws when extension is missing', () => {
      vi.stubGlobal('window', {});
      expect(() => reduxDevtools()).toThrow('Redux Devtools extension is not installed');
    });

    it('connects with default name "RxToolkit"', () => {
      const { extension } = createMockExtension();
      reduxDevtools({ driver: extension });
      expect(extension.connect).toHaveBeenCalledWith({ name: 'RxToolkit' });
    });

    it('connects with custom name', () => {
      const { extension } = createMockExtension();
      reduxDevtools({ driver: extension, name: 'MyApp' });
      expect(extension.connect).toHaveBeenCalledWith({ name: 'MyApp' });
    });

    it('calls init with empty state', () => {
      const { extension, connection } = createMockExtension();
      reduxDevtools({ driver: extension });
      expect(connection.init).toHaveBeenCalledWith({});
    });
  });

  describe('window.__REDUX_DEVTOOLS_EXTENSION__', () => {
    it('uses window extension when no driver provided', () => {
      const { extension, connection } = createMockExtension();
      vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', extension);
      reduxDevtools();
      expect(extension.connect).toHaveBeenCalled();
      expect(connection.init).toHaveBeenCalledWith({});
    });
  });

  describe('state() and updater', () => {
    it('state() schedules a "create" send', async () => {
      const { extension, connection } = createMockExtension();
      reduxDevtools({ driver: extension, batchStrategy: 'microtask' })
        .state('counter', 0);

      // Wait for microtask flush
      await Promise.resolve();

      expect(connection.send).toHaveBeenCalledWith(
        { type: 'create' },
        { counter: 0 },
      );
    });

    it('updater schedules an "update" send', async () => {
      const { extension, connection } = createMockExtension();
      const dt = reduxDevtools({ driver: extension, batchStrategy: 'microtask' });
      const updater = dt.state('counter', 0);

      // Flush the initial create
      await Promise.resolve();
      connection.send.mockClear();

      updater(42);

      await Promise.resolve();

      expect(connection.send).toHaveBeenCalledWith(
        { type: 'update' },
        { counter: 42 },
      );
    });

    it('$COMPLETED triggers "clear" and removes state key', async () => {
      const { extension, connection } = createMockExtension();
      const dt = reduxDevtools({ driver: extension, batchStrategy: 'microtask' });
      const updater = dt.state('counter', 0);

      await Promise.resolve();
      connection.send.mockClear();

      updater('$COMPLETED' as any);

      await Promise.resolve();

      expect(connection.send).toHaveBeenCalledWith(
        { type: 'clear' },
        {},
      );
    });

    it('$CLEANED triggers "clear" and removes state key', async () => {
      const { extension, connection } = createMockExtension();
      const dt = reduxDevtools({ driver: extension, batchStrategy: 'microtask' });
      const updater = dt.state('counter', 0);

      await Promise.resolve();
      connection.send.mockClear();

      updater('$CLEANED' as any);

      await Promise.resolve();

      expect(connection.send).toHaveBeenCalledWith(
        { type: 'clear' },
        {},
      );
    });

    it('nested state keys via "/" separator', async () => {
      const { extension, connection } = createMockExtension();
      const dt = reduxDevtools({ driver: extension, batchStrategy: 'microtask' });
      dt.state('group/counter', 10);

      await Promise.resolve();

      expect(connection.send).toHaveBeenCalledWith(
        { type: 'create' },
        { group: { counter: 10 } },
      );
    });
  });

  describe('batch strategies', () => {
    it('sync strategy sends via Batcher scheduler', async () => {
      const { extension, connection } = createMockExtension();
      const dt = reduxDevtools({ driver: extension, batchStrategy: 'sync' });
      dt.state('x', 1);

      // Batcher.scheduler(Infinity) defers to end of batch or runs immediately
      // Give it a microtask to settle
      await Promise.resolve();
      await Promise.resolve();

      expect(connection.send).toHaveBeenCalled();
    });

    it('task strategy sends after setTimeout', async () => {
      vi.useFakeTimers();
      const { extension, connection } = createMockExtension();
      const dt = reduxDevtools({ driver: extension, batchStrategy: 'task', taskDelay: 50 });
      dt.state('x', 1);

      expect(connection.send).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);

      expect(connection.send).toHaveBeenCalledWith(
        { type: 'create' },
        { x: 1 },
      );
      vi.useRealTimers();
    });

    it('microtask strategy batches multiple updates', async () => {
      const { extension, connection } = createMockExtension();
      const dt = reduxDevtools({ driver: extension, batchStrategy: 'microtask' });
      const updater = dt.state('counter', 0);

      // Before microtask flushes, do an update too
      updater(1);
      updater(2);

      await Promise.resolve();

      // All batched into one send — only the last state is sent
      expect(connection.send).toHaveBeenCalledTimes(1);
      expect(connection.send).toHaveBeenCalledWith(
        { type: 'create' },
        { counter: 2 },
      );
    });
  });
});
