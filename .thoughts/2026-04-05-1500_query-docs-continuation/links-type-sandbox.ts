// ============================================================
// Links API — Type Inference Sandbox
// Goal: find which API shape correctly infers TCommandArgs
// inside forwardArgs: (commandArgs: TCommandArgs) => TResourceArgs
// ============================================================

// --- Minimal type stubs ---

interface IResource<TArgs, TData> {
  __brand: 'resource';
  __args: TArgs;
  __data: TData;
}

interface LinkConfig<TCommandArgs, TResourceArgs> {
  forwardArgs: (commandArgs: TCommandArgs) => TResourceArgs;
  invalidate?: boolean;
  optimisticUpdate?: (draft: unknown, commandArgs: TCommandArgs) => void;
}

interface LinkConfig2<TArgs, TData, TCommandArgs, TCommandData> {
    forwardArgs: (commandArgs: TCommandArgs) => TArgs;
    invalidate?: boolean;
    update?: (draft: TData, commandArgs: TCommandArgs, commandResult: TCommandData) => void;
}

// A link declaration that erases the generics for storage
interface LinkDeclaration {
  __brand: 'link';
}

// ============================================================
// APPROACH 1: resource.link(config)
// resource is IResource<TResArgs, TResData>
// link() is defined ON the resource — it knows TResArgs but NOT TCommandArgs
// ============================================================

interface IResourceWithLink<TArgs, TData> extends IResource<TArgs, TData> {
  // Problem: link() has no way to know TCommandArgs unless caller provides it
  // Option A: TCommandArgs stays `unknown`
  link(config: { forwardArgs: (commandArgs: unknown) => TArgs }): LinkDeclaration;
  // Option B: explicit generic on the method
  linkGeneric<TCommandArgs>(config: LinkConfig<TCommandArgs, TArgs>): LinkDeclaration;

  link2<TCommandArgs, TCommandData>(config: LinkConfig2<TArgs, TData, TCommandArgs, TCommandData>): LinkConfig2<TArgs, TData, TCommandArgs, TCommandData>;
}

// Command definition using Approach 1
interface CommandConfig1<TArgs, TResult> {
  handler: (args: TArgs) => Promise<TResult>;
  links?: LinkDeclaration[]; // just an array of opaque declarations
}



// Command definition using Approach 1
interface CommandConfig0<TArgs, TResult, TLinks extends LinkDeclaration<any, any, TArgs, TResult>[]> {
    handler: (args: TArgs) => Promise<TResult>;
    links?: TLinks;
}


declare function createCommand0<TArgs, TResult, TLinks extends LinkDeclaration<any, any, TArgs, TResult>[]>(
    config: CommandConfig0<TArgs, TResult, TLinks>,
): void;


// --- TEST: Approach 0 ---
declare const userResource0: IResourceWithLink<{ userId: string }, { name: string }>;

createCommand0({
  handler: async (args: { userId: string; newName: string }) => null as unknown as { userId: string, name: string },
  links: [
    userResource0.link2({
        forwardArgs: (commandArgs) => ({ userId: commandArgs.userId }),
        update: (draft, commandArgs, commandResult) => {

        },
    }),
  ],
});


declare function createCommand1<TArgs, TResult>(
  config: CommandConfig1<TArgs, TResult>,
): void;

// --- Test: Approach 1A (unknown commandArgs) ---
declare const userResource1: IResourceWithLink<{ userId: string }, { name: string }>;

createCommand1<{ userId: string; newName: string }, void>({
  handler: async (args) => {},
  links: [
    // ❌ commandArgs is `unknown` — no inference
    userResource1.link({
      forwardArgs: (commandArgs) => {
        // commandArgs: unknown — user must cast
        return { userId: (commandArgs as any).userId };
      },
    }),
  ],
});

// --- Test: Approach 1B (explicit generic) ---
createCommand1<{ userId: string; newName: string }, void>({
  handler: async (args) => {},
  links: [
    // ⚠️ Works BUT user must manually supply TCommandArgs
    userResource1.linkGeneric<{ userId: string; newName: string }>({
      forwardArgs: (commandArgs) => {
        // ✅ commandArgs: { userId: string; newName: string }
        return { userId: commandArgs.userId };
      },
    }),
  ],
});

// ============================================================
// APPROACH 2: createLink(resource, config) — standalone function
// The function takes the resource AND the config, so it can
// constrain TResourceArgs from the resource.
// But does it know TCommandArgs? Only if the COMMAND provides context.
// ============================================================

declare function createLink<TResArgs, TResData, TCommandArgs>(
  resource: IResource<TResArgs, TResData>,
  config: LinkConfig<TCommandArgs, TResArgs>,
): LinkDeclaration;

// Same command but with links as array (still opaque LinkDeclaration[])
// TCommandArgs cannot be inferred because LinkDeclaration is erased
createCommand1<{ userId: string; newName: string }, void>({
  handler: async (args) => {},
  links: [
    // ❌ TCommandArgs defaults to `unknown` — no context from command
    createLink(userResource1, {
      forwardArgs: (commandArgs) => {
        // commandArgs: unknown
        return { userId: (commandArgs as any).userId };
      },
    }),
  ],
});

// ============================================================
// APPROACH 3: links as generic config objects, resolved by createCommand
// The command's createX function receives raw link configs (not erased)
// so it can thread TCommandArgs through.
// ============================================================

interface LinkConfigWithResource<TCommandArgs, TResArgs> {
  resource: IResource<TResArgs, any>;
  forwardArgs: (commandArgs: TCommandArgs) => TResArgs;
  invalidate?: boolean;
  optimisticUpdate?: (draft: unknown, commandArgs: TCommandArgs) => void;
}

// The key trick: links is a TUPLE of LinkConfigWithResource<TArgs, any_res_args>
// TArgs is the same as the command's TArgs — the compiler can infer it.
declare function createCommand3<TArgs, TResult>(config: {
  handler: (args: TArgs) => Promise<TResult>;
  links?: LinkConfigWithResource<TArgs, any>[];
}): void;

declare const userResource3: IResource<{ userId: string }, { name: string }>;
declare const listResource3: IResource<void, { users: string[] }>;

createCommand3({
  handler: async (args: { userId: string; newName: string }) => {},
  links: [
    {
      resource: userResource3,
      // ✅ commandArgs correctly inferred as { userId: string; newName: string }
      forwardArgs: (commandArgs) => ({ userId: commandArgs.userId }),
      invalidate: true,
    },
    {
      resource: listResource3,
      // ✅ commandArgs correctly inferred
      forwardArgs: (_commandArgs) => undefined as unknown as void,
      invalidate: true,
    },
  ],
});

// --- Verify forwardArgs return type is checked ---
// ⚠️ FINDING: `LinkConfigWithResource<TArgs, any>[]` uses `any` for TResArgs,
// so forwardArgs return type is NOT checked per-resource. This passes without error:
createCommand3({
  handler: async (args: { userId: string }) => {},
  links: [
    {
      resource: userResource3,
      // ❌ This SHOULD error (returns { bad } instead of { userId }) but doesn't
      //    because `any` in the array erases TResArgs checking
      forwardArgs: (commandArgs) => ({ bad: commandArgs.userId }),
    },
  ],
});

// FIX: Use a helper that captures TResArgs per-link via a function call
function link<TCommandArgs, TResArgs>(
  resource: IResource<TResArgs, any>,
  config: Omit<LinkConfigWithResource<TCommandArgs, TResArgs>, 'resource'>,
): LinkConfigWithResource<TCommandArgs, TResArgs> {
  return { ...config, resource };
}

// Now createCommand still uses any[] but the per-link `link()` call checks return type
declare function createCommand3b<TArgs, TResult>(config: {
  handler: (args: TArgs) => Promise<TResult>;
  links?: LinkConfigWithResource<TArgs, any>[];
}): void;

createCommand3b({
  handler: async (args: { userId: string; newName: string }) => {},
  links: [
    // ❌ commandArgs is `unknown` — link() is evaluated before createCommand resolves TArgs
    //    BUT return type IS checked by link() helper
    // link(userResource3, {
    //   forwardArgs: (commandArgs) => ({ userId: commandArgs.userId }),
    // }),
  ],
});

// ============================================================
// APPROACH 6 (BEST): links as callback receiving a pre-typed `link` function
// createCommand provides TArgs into the callback, link() captures TResArgs
// ============================================================

declare function createCommand6<TArgs, TResult>(config: {
  handler: (args: TArgs) => Promise<TResult>;
  links?: (
    link: <TResArgs>(
      resource: IResource<TResArgs, any>,
      config: {
        forwardArgs: (commandArgs: TArgs) => TResArgs;
        invalidate?: boolean;
        optimisticUpdate?: (draft: unknown, commandArgs: TArgs) => void;
      },
    ) => void,
  ) => void;
}): void;

createCommand6({
  handler: async (args: { userId: string; newName: string }) => {},
  links: (link) => {
    // ✅ commandArgs inferred as { userId: string; newName: string }
    // ✅ return type checked against { userId: string }
    link(userResource3, {
      forwardArgs: (commandArgs) => ({ userId: commandArgs.userId }),
      invalidate: true,
    });

    // ✅ void resource works too
    link(listResource3, {
      forwardArgs: () => undefined as unknown as void,
      invalidate: true,
    });
  },
});

// Verify return type mismatch IS caught:
createCommand6({
  handler: async (args: { userId: string }) => {},
  links: (link) => {
    link(userResource3, {
      // @ts-expect-error — { bad: string } is not assignable to { userId: string }
      forwardArgs: (commandArgs) => ({ bad: commandArgs.userId }),
    });
  },
});

// ============================================================
// APPROACH 4: Hybrid — resource.link() returns a BUILDER that
// createCommand resolves. Best DX of approaches 1 + 3.
// ============================================================

interface LinkBuilder<TResArgs> {
  __resArgs: TResArgs;
  __brand: 'link-builder';
}

interface IResourceWithBuilder<TArgs, TData> extends IResource<TArgs, TData> {
  link(config: {
    invalidate?: boolean;
  }): LinkBuilder<TArgs>;
}

// The resolver type: createCommand extracts TResArgs from LinkBuilder
// and provides the forwardArgs callback in context
type ResolvedLink<TCommandArgs, TResArgs> = {
  builder: LinkBuilder<TResArgs>;
  forwardArgs: (commandArgs: TCommandArgs) => TResArgs;
  optimisticUpdate?: (draft: unknown, commandArgs: TCommandArgs) => void;
};

declare function createCommand4<TArgs, TResult>(config: {
  handler: (args: TArgs) => Promise<TResult>;
  links?: ResolvedLink<TArgs, any>[];
}): void;

declare const userResource4: IResourceWithBuilder<{ userId: string }, { name: string }>;

createCommand4({
  handler: async (args: { userId: string; newName: string }) => {},
  links: [
    {
      builder: userResource4.link({ invalidate: true }),
      // ✅ commandArgs inferred as { userId: string; newName: string }
      forwardArgs: (commandArgs) => ({ userId: commandArgs.userId }),
    },
  ],
});

// ============================================================
// APPROACH 5 (SIMPLEST): resource.link<TCommandArgs>(config)
// with forwardArgs typed but user supplies the command-args generic once.
// Alias-style — keeps the resource.link() call shape.
// ============================================================

interface IResource5<TArgs, TData> {
  link<TCommandArgs>(
    config: LinkConfig<TCommandArgs, TArgs> & { invalidate?: boolean },
  ): LinkDeclaration;
}

declare const userResource5: IResource5<{ userId: string }, { name: string }>;

// Usage: user passes TCommandArgs explicitly once
const link5 = userResource5.link<{ userId: string; newName: string }>({
  forwardArgs: (commandArgs) => {
    // ✅ commandArgs: { userId: string; newName: string }
    return { userId: commandArgs.userId };
  },
});

// But inference still fails when used inline without explicit generic:
declare function createCommand5<TArgs, TResult>(config: {
  handler: (args: TArgs) => Promise<TResult>;
  links?: LinkDeclaration[];
}): void;

createCommand5({
  handler: async (args: { userId: string; newName: string }) => {},
  links: [
    // ❌ TCommandArgs not inferred from command context (LinkDeclaration is opaque)
    userResource5.link({
      forwardArgs: (commandArgs) => {
        // commandArgs: unknown
        return { userId: (commandArgs as any).userId };
      },
    }),
  ],
});
