import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { Window } from "happy-dom";

import { embedOrigin } from "../config/site.js";
import type { Slot } from "../types/models.js";

type LockApi = {
  init_wasm?: () => Promise<void> | void;
  set_stream_jw: (source: string, id: string, stream: string) => Promise<void>;
};

type LockModule = {
  default: (opts: {
    module_or_path: string;
    fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  }) => Promise<LockApi>;
};

type WorkerInput = { slot: Slot; goat: string; bodyHex: string };

type WasmImports = { [module: string]: { [name: string]: unknown } };

type WasmModule = {
  instantiate: (
    source: Buffer | ArrayBuffer | Uint8Array | object,
    imports?: WasmImports,
  ) => Promise<unknown>;
  instantiateStreaming?: (
    source: Response | PromiseLike<Response>,
    imports?: WasmImports,
  ) => Promise<unknown>;
};

const vendorDir = join(dirname(fileURLToPath(import.meta.url)), "vendor");
const wasmBytes = readFileSync(join(vendorDir, "lock.wasm"));
const lockModuleUrl = pathToFileURL(join(vendorDir, "lock-esm.mjs")).href;

function asBody(data: Buffer): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function pageUrl(slot: Slot): string {
  return `${embedOrigin}/embed/${slot.path}`;
}

function mountDom(slot: Slot): void {
  const window = new Window({ url: pageUrl(slot) });
  const doc = window.document;
  doc.body.innerHTML = '<div id="player"></div>';

  const jwCfg: { file: string | null } = { file: null };
  const jwBase = {
    getContainer: () => doc.getElementById("player"),
    getState: () => "idle",
    load: (cfg?: { file?: string }) => {
      if (cfg?.file) jwCfg.file = cfg.file;
    },
    setConfig: (cfg?: { file?: string }) => {
      if (cfg?.file) jwCfg.file = cfg.file;
    },
    getConfig: () => jwCfg,
    setup: () => {},
    on: () => {},
    play: () => {},
    getPlaylistItem: () => jwCfg,
    getPlaylist: () => (jwCfg.file ? [{ file: jwCfg.file }] : []),
  };

  const proxy = new Proxy(jwBase, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
      if (prop === Symbol.toStringTag) return "Object";
      return () => null;
    },
  });

  Object.assign(window, { __wasm_jw_player: proxy, jwplayer: () => proxy });

  const root = globalThis as Record<string, unknown>;
  root.window = window;
  root.document = doc;
  root.location = window.location;
  root.self = window;
  root.atob = (s: string) => Buffer.from(s, "base64").toString("binary");
  root.btoa = (s: string) => Buffer.from(s, "binary").toString("base64");

  const NativeRequest = globalThis.Request;
  const NativeUrl = globalThis.URL;

  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    writable: true,
    value: class extends NativeUrl {
      constructor(input: string | URL, base?: string | URL) {
        super(input === "/fetch" ? `${embedOrigin}/fetch` : input, base ?? `${embedOrigin}/`);
      }
    },
  });

  Object.defineProperty(globalThis, "Request", {
    configurable: true,
    writable: true,
    value: class extends NativeRequest {
      constructor(input: string | URL | Request, init?: RequestInit) {
        super(input === "/fetch" ? `${embedOrigin}/fetch` : input, init);
      }
    },
  });

  Object.assign(window, {
    URL: globalThis.URL,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
  });
}

function mockFetch(
  goat: string,
  body: Buffer,
  onM3u8: (url: string) => void,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input) => {
    const href =
      typeof input === "string" ? input : input instanceof URL ? input.href : String((input as Request).url);
    if (href.includes("lock.wasm")) {
      return new Response(asBody(wasmBytes), {
        status: 200,
        headers: { "Content-Type": "application/wasm" },
      });
    }
    if (href.includes("/fetch")) {
      return new Response(asBody(body), {
        status: 200,
        headers: { goat, "Content-Type": "application/octet-stream" },
      });
    }
    if (href.includes(".m3u8")) {
      onM3u8(href);
      return new Response("#EXTM3U\n#EXT-X-VERSION:3\n", {
        status: 200,
        headers: { "Content-Type": "application/vnd.apple.mpegurl" },
      });
    }
    return new Response("", { status: 404 });
  };
}

/**
 * Build the ./locked_bg.js import module that the WASM binary expects.
 * When the glue code omits it from the imports object (Node.js env),
 * we create it with implementations backed by the happy-dom mock DOM.
 */
function buildLockedBgModule(
  goat: string,
  body: Buffer,
  onM3u8: (url: string) => void,
): Record<string, Function> {
  const win = (globalThis as Record<string, unknown>).window as Record<string, unknown> | undefined;
  const doc = (globalThis as Record<string, unknown>).document as Record<string, unknown> | undefined;

  const fetchHandler = (_win: unknown, req: { url?: string }) => {
    const href = req?.url ?? "";
    if (href.includes("/fetch")) {
      return Promise.resolve(
        new Response(asBody(body), {
          status: 200,
          headers: { goat, "Content-Type": "application/octet-stream" },
        }),
      );
    }
    if (href.includes(".m3u8")) {
      onM3u8(href);
      return Promise.resolve(
        new Response("#EXTM3U\n#EXT-X-VERSION:3\n", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        }),
      );
    }
    return Promise.reject(new Error(`unexpected wasm fetch ${href}`));
  };

  const noop = (..._args: unknown[]) => 0;
  const ret1 = (..._args: unknown[]) => 1;

  return {
    __wbg_instanceof_Window_ed49b2db8df90359: ret1,
    __wbg_instanceof_Document_50f5ff170c1a7826: ret1,
    __wbg_instanceof_Response_ee1d54d79ae41977: ret1,
    __wbg_instanceof_Promise_0094681e3519d6ec: ret1,
    __wbg_fetch_e6e8e0a221783759: fetchHandler,
    __wbg_document_ee35a3d3ae34ef6c: () => doc ?? null,
    __wbg_defaultView_979b3a6d37a30a3a: () => (doc as any)?.defaultView ?? null,
    __wbg_body_f67922363a220026: () => (doc as any)?.body ?? null,
    __wbg_createElement_49f60fdcaae809c8: (_d: unknown, name: unknown) => {
      try { return (doc as any)?.createElement?.(name) ?? null; } catch { return null; }
    },
    __wbg_querySelector_c3b0df2d58eec220: (_d: unknown, sel: unknown) => {
      try { return (doc as any)?.querySelector?.(sel) ?? null; } catch { return null; }
    },
    __wbg_getElementById_e34377b79d7285f6: (_d: unknown, id: unknown) => {
      try { return (doc as any)?.getElementById?.(id) ?? null; } catch { return null; }
    },
    __wbg_appendChild_dea38765a26d346d: (parent: unknown, child: unknown) => {
      try { (parent as any)?.appendChild?.(child); } catch {}
      return 0;
    },
    __wbg_remove_31c39325eee968fc: (el: unknown) => {
      try { (el as any)?.remove?.(); } catch {}
      return 0;
    },
    __wbg_setAttribute_cc8e4c8a2a008508: (el: unknown, name: unknown, value: unknown) => {
      try { (el as any)?.setAttribute?.(name, value); } catch {}
      return 0;
    },
    __wbg_set_id_9b8330f661385753: (el: unknown, id: unknown) => {
      try { (el as any).id = id; } catch {}
      return 0;
    },
    __wbg_id_ff64a5892a30d4e9: (el: unknown) => {
      try { return (el as any)?.id ?? null; } catch { return null; }
    },
    __wbg_set_textContent_3e87dba095d9cdbc: (el: unknown, val: unknown) => {
      try { (el as any).textContent = val; } catch {}
      return 0;
    },
    __wbg_navigator_43be698ba96fc088: () => (win as Record<string, unknown>)?.navigator ?? null,
    __wbg_userAgent_34463fd660ba4a2a: () => {
      try { return ((win as Record<string, unknown>)?.navigator as Record<string, unknown>)?.userAgent ?? ""; } catch { return ""; }
    },
    __wbg_static_accessor_GLOBAL_THIS_e628e89ab3b1c95f: () => globalThis,
    __wbg_static_accessor_SELF_a621d3dfbb60d0ce: () => globalThis,
    __wbg_static_accessor_GLOBAL_12837167ad935116: () => globalThis,
    __wbg_static_accessor_WINDOW_f8727f0cf888e0bd: () => win ?? globalThis,
    __wbg_eval_3f0b9f0cbaf45a34: (code: unknown) => {
      try { return eval(String(code)); } catch { return null; }
    },
        __wbg_ok_87f537440a0acf85: (resp: unknown) => {
      try { return (resp as Response).ok ? 1 : 0; } catch { return 0; }
    },
    __wbg_arrayBuffer_bb54076166006c39: (resp: unknown) => {
      try { return (resp as Response).arrayBuffer(); } catch { return Promise.resolve(new ArrayBuffer(0)); }
    },
    __wbg_text_083b8727c990c8c0: (resp: unknown) => {
      try { return (resp as Response).text(); } catch { return Promise.resolve(""); }
    },
    __wbg_headers_5a897f7fee9a0571: (resp: unknown) => {
      try { return (resp as Response).headers ?? null; } catch { return null; }
    },
    __wbg_headers_59a2938db9f80985: () => {
      try { return new Headers(); } catch { return null; }
    },
    __wbg_new_with_str_and_init_a61cbc6bdef21614: (url: unknown, init: unknown) => {
      try {
        const opts: RequestInit = {};
        if (init && typeof init === "object") {
          const i = init as Record<string, unknown>;
          if (i.method) opts.method = String(i.method);
          if (i.headers) opts.headers = i.headers as Record<string, string>;
          if (i.body) opts.body = i.body as ArrayBuffer | Uint8Array | string;
          if (i.mode) opts.mode = String(i.mode) as "navigate" | "same-origin" | "no-cors" | "cors";
        }
        return new Request(String(url), opts);
      } catch { return null; }
    },
    __wbg_set_method_c3e20375f5ae7fac: noop,
    __wbg_set_body_9a7e00afe3cfe244: noop,
    __wbg_set_mode_b13642c312648202: noop,
    __wbg_get_941633a1d2f510cb: (map: unknown, key: unknown) => {
      try { return (map as Map<unknown, unknown>).get?.(key) ?? (map as Record<string, unknown>)?.[String(key)] ?? null; } catch { return null; }
    },
    __wbg_set_db769d02949a271d: (map: unknown, key: unknown, value: unknown) => {
      try { (map as Map<unknown, unknown>).set?.(key, value); } catch {}
      return 0;
    },
    __wbg_length_32ed9a279acd054c: (arr: unknown) => {
      try { return (arr as { length: number }).length ?? 0; } catch { return 0; }
    },
    __wbg_push_8ffdcb2063340ba5: (arr: unknown, val: unknown) => {
      try { return (arr as unknown[]).push(val); } catch { return 0; }
    },
    __wbg_of_f915f7cd925b21a5: (...args: unknown[]) => {
      try { return Array.of(...args); } catch { return []; }
    },
    __wbg_new_3eb36ae241fe6f44: () => { try { return []; } catch { return null; } },
    __wbg_new_361308b2356cecd0: () => { try { return new Map(); } catch { return null; } },
    __wbg_new_no_args_1c7c842f08d00ebb: () => { try { return []; } catch { return null; } },
    __wbg_new_dd2b680c8bf6ae29: (len: unknown) => { try { return new Uint8Array(Number(len) || 0); } catch { return null; } },
    __wbg_new_from_slice_a3d2629dc1826784: (slice: unknown) => {
      try { return new Uint8Array(slice as Uint8Array); } catch { return null; }
    },
    __wbg_prototypesetcall_bdcdcc5842e4d77d: noop,
    __wbg_new_b5d9e2fb389fef91: (fn: unknown) => {
      try { return new Promise(fn as ConstructorParameters<typeof Promise>[0]); } catch { return Promise.resolve(); }
    },
    __wbg_resolve_002c4b7d9d8f6b64: (val: unknown) => { try { return Promise.resolve(val); } catch { return Promise.resolve(); } },
    __wbg_then_b9e7b3b5f1a9e1b5: (p: unknown, cb: unknown) => {
      try { return (p as Promise<unknown>).then(cb as (v: unknown) => unknown); } catch { return Promise.resolve(); }
    },
    __wbg_then_0d9fe2c7b1857d32: (p: unknown, cb: unknown, eb: unknown) => {
      try { return (p as Promise<unknown>).then(cb as (v: unknown) => unknown, eb as (v: unknown) => unknown); } catch { return Promise.resolve(); }
    },
    __wbg_get_b3ed3ad4be2bc8ac: (obj: unknown, key: unknown) => {
      try { return (obj as Record<string, unknown>)[String(key)] ?? null; } catch { return null; }
    },
    __wbg_set_6cb8631f80447a67: (obj: unknown, key: unknown, value: unknown) => {
      try { (obj as Record<string, unknown>)[String(key)] = value; } catch {}
      return 0;
    },
    __wbg_construct_86626e847de3b629: (ctor: unknown, args: unknown) => {
      try { return new (ctor as any)(...(args as any[] ?? [])); } catch { return null; }
    },
    __wbg_call_389efe28435a9388: (fn: unknown, thisVal: unknown, args: unknown) => {
      try { return (fn as Function).call(thisVal, ...(args as unknown[] ?? [])); } catch { return null; }
    },
    __wbg_call_4708e0c13bdc8e95: (fn: unknown, thisVal: unknown, args: unknown) => {
      try { return (fn as Function).apply(thisVal, args as unknown[] ?? []); } catch { return null; }
    },
    __wbg_call_812d25f1510c13c8: (fn: unknown, thisVal: unknown, args: unknown) => {
      try { return (fn as Function).apply(thisVal, args as unknown[] ?? []); } catch { return null; }
    },
    __wbg_call_e8c868596c950cf6: (fn: unknown, thisVal: unknown, args: unknown) => {
      try { return (fn as Function).apply(thisVal, args as unknown[] ?? []); } catch { return null; }
    },
    __wbg_queueMicrotask_5bb536982f78a56f: (fn: unknown) => {
      try { queueMicrotask(fn as () => void); } catch {}
      return 0;
    },
    __wbg_queueMicrotask_0aa0a927f78f5d98: (fn: unknown) => {
      try { queueMicrotask(fn as () => void); } catch {}
      return 0;
    },
    __wbg___wbindgen_string_get_72fb696202c56729: (_idx: unknown, ptr: unknown) => {
      try {
        const s = String(ptr);
        const encoder = new TextEncoder();
        const buf = encoder.encode(s);
        return buf.length;
      } catch { return 0; }
    },
    __wbg___wbindgen_number_get_8ff4255516ccad3e: (_idx: unknown, ptr: unknown) => {
      try { return Number(ptr); } catch { return 0; }
    },
    __wbg___wbindgen_throw_be289d5034ed271b: (ptr: unknown, len: unknown) => {
      try {
        const msg = new TextDecoder().decode(new Uint8Array(ptr as ArrayBuffer, Number(len)));
        throw new Error(msg);
      } catch (e) { throw e; }
    },
    __wbg___wbindgen_is_null_ac34f5003991759a: (val: unknown) => val === null ? 1 : 0,
    __wbg___wbindgen_boolean_get_bbbb1c18aa2f5e25: (val: unknown) => val ? 1 : 0,
    __wbg___wbindgen_is_function_0095a73b8b156f76: (val: unknown) => typeof val === "function" ? 1 : 0,
    __wbg___wbindgen_is_undefined_9e4d92534c42d778: (val: unknown) => typeof val === "undefined" ? 1 : 0,
    __wbg__wbg_cb_unref_d9b87ff7982e3b21: noop,
    __wbindgen_init_externref_table: noop,
    __wbindgen_cast_0000000000000001: noop,
    __wbindgen_cast_0000000000000002: noop,
    __wbindgen_cast_0000000000000003: noop,
    __wbindgen_cast_0000000000000004: noop,
  };
}

function patchImports(
  imports: WasmImports | undefined,
  goat: string,
  body: Buffer,
  onM3u8: (url: string) => void,
): void {
  if (!imports) return;

  let bg = imports["./locked_bg.js"] as Record<string, Function> | undefined;

  if (!bg) {
    bg = buildLockedBgModule(goat, body, onM3u8);
    imports["./locked_bg.js"] = bg;
  }

  for (const key of Object.keys(bg)) {
    if (!key.includes("instanceof")) continue;
    const orig = bg[key];
    if (typeof orig !== "function") continue;
    bg[key] = (...args: unknown[]) => ((orig as (...a: unknown[]) => unknown)(...args) ? 1 : 1);
  }

  const fetchKey = Object.keys(bg).find((k) => k.includes("fetch_e6e8e0"));
  if (fetchKey && typeof bg[fetchKey] === "function") {
    bg[fetchKey] = (_win: unknown, req: { url?: string }) => {
      const href = req?.url ?? "";
      if (href.includes("/fetch")) {
        return Promise.resolve(
          new Response(asBody(body), {
            status: 200,
            headers: { goat, "Content-Type": "application/octet-stream" },
          }),
        );
      }
      if (href.includes(".m3u8")) {
        onM3u8(href);
        return Promise.resolve(
          new Response("#EXTM3U\n#EXT-X-VERSION:3\n", {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected wasm fetch ${href}`));
    };
  }
}

async function crack(slot: Slot, goat: string, bodyHex: string): Promise<string> {
  let m3u8: string | null = null;
  const body = Buffer.from(bodyHex, "hex");
  const onM3u8 = (url: string) => {
    m3u8 = url;
  };
  mountDom(slot);
  const fetchFn = mockFetch(goat, body, onM3u8);
  (globalThis as unknown as { fetch: typeof fetchFn }).fetch = fetchFn;

  const wasm = (globalThis as unknown as { WebAssembly: WasmModule }).WebAssembly;
  const origInstantiate = wasm.instantiate.bind(wasm);
  wasm.instantiate = async (source, imports) => {
    patchImports(imports, goat, body, onM3u8);
    let bytes: Buffer | ArrayBuffer | Uint8Array | object = source;
    if (!(source instanceof ArrayBuffer) && !ArrayBuffer.isView(source)) {
      bytes = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);
    }
    return origInstantiate(bytes, imports);
  };
  wasm.instantiateStreaming = async (_resp, imports) => wasm.instantiate(wasmBytes, imports);

  const mod = (await import(lockModuleUrl)) as LockModule;
  const api = await mod.default({
    module_or_path: `${embedOrigin}/js/wasm/lock.wasm`,
    fetch: fetchFn,
  });
  await api.init_wasm?.();

  wasm.instantiate = origInstantiate;
  delete (wasm as { instantiateStreaming?: unknown }).instantiateStreaming;

  try {
    await api.set_stream_jw(slot.source, slot.id, slot.stream);
  } catch (err) {
    if (!m3u8) throw err;
  }
  if (!m3u8) throw new Error("lock did not yield m3u8");
  return m3u8;
}

const input = workerData as WorkerInput;
crack(input.slot, input.goat, input.bodyHex)
  .then((url) => parentPort?.postMessage({ ok: true, url }))
  .catch((err: unknown) =>
    parentPort?.postMessage({
      ok: false,
      error: err instanceof Error ? err.message || err.stack || "lock decrypt failed" : String(err),
    }),
  );
