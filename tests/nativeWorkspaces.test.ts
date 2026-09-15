import { describe, expect, it } from "vitest";
import {
  detectNativeWorkspaces,
  effectiveRestoreLayouts,
} from "../src/layout/nativeWorkspaces";

describe("detectNativeWorkspaces", () => {
  it("reports disabled when the plugin lookup returns nothing", () => {
    const app = { internalPlugins: { getEnabledPluginById: () => null } };
    expect(detectNativeWorkspaces(app)).toBe("disabled");
  });

  it("reports enabled when the plugin lookup returns an object", () => {
    const app = { internalPlugins: { getEnabledPluginById: () => ({}) } };
    expect(detectNativeWorkspaces(app)).toBe("enabled");
  });

  it("asks for the workspaces plugin by id", () => {
    const seen: string[] = [];
    const app = {
      internalPlugins: {
        getEnabledPluginById: (id: string) => {
          seen.push(id);
          return null;
        },
      },
    };
    detectNativeWorkspaces(app);
    expect(seen).toEqual(["workspaces"]);
  });

  it("reports unknown when internalPlugins is absent", () => {
    expect(detectNativeWorkspaces({})).toBe("unknown");
  });

  it("reports unknown when the lookup is not a function", () => {
    expect(detectNativeWorkspaces({ internalPlugins: {} })).toBe("unknown");
  });

  it("reports unknown when the lookup throws", () => {
    const app = {
      internalPlugins: {
        getEnabledPluginById: () => {
          throw new Error("private api changed");
        },
      },
    };
    expect(detectNativeWorkspaces(app)).toBe("unknown");
  });
});

describe("effectiveRestoreLayouts", () => {
  it("is true only when configured on and native Workspaces is disabled", () => {
    expect(effectiveRestoreLayouts(true, "disabled")).toBe(true);
  });

  it("is false when native Workspaces is enabled", () => {
    expect(effectiveRestoreLayouts(true, "enabled")).toBe(false);
  });

  it("treats unknown as not-disabled, so it fails safe", () => {
    expect(effectiveRestoreLayouts(true, "unknown")).toBe(false);
  });

  it("is false when configured off regardless of status", () => {
    expect(effectiveRestoreLayouts(false, "disabled")).toBe(false);
  });
});
