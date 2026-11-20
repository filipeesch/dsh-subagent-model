import { describe, expect, it } from "vitest";
import { createCatalogTool } from "../lib/catalog.js";
import { createDelegationTool } from "../lib/delegation.js";
import {
  CATALOG_DESCRIPTION,
  CATALOG_PROPERTIES,
  DELEGATE_TOOL_NAME,
  DELEGATION_DESCRIPTION,
  DELEGATION_PROPERTIES,
  DELEGATION_REQUIRED,
  LIST_TOOL_NAME,
  REPLACEMENTS,
  depthNotice,
  guidanceText,
  backendOptionsText,
  contextContractText,
  EFFORT_REQUIRES_MODEL_TEXT,
  missingBackendText,
  missingContextModeText,
  missingModelSeamText,
  NO_LLM_SERVICE_TEXT,
  NO_MODEL_ROUTE_TEXT,
  NO_PROVIDER_ROUTE_TEXT,
  PROVIDER_REQUIRES_MODEL_TEXT,
  refusalText,
  unknownCatalogProviderText,
  unpinnedChildText
} from "../lib/descriptions.js";
import { MASKED_TOOLS } from "../lib/native-mask.js";
import { createLlm, createSubagents } from "./helpers/fakes.js";

describe("descriptions", () => {
  it("is the single source of the tool surface text", () => {
    const catalog = createCatalogTool(createLlm());
    const delegation = createDelegationTool({ llm: createLlm(), subagents: createSubagents() });

    expect(catalog.name).toBe(LIST_TOOL_NAME);
    expect(catalog.description).toBe(CATALOG_DESCRIPTION);
    expect(catalog.parameters.properties).toBe(CATALOG_PROPERTIES);
    expect(delegation.name).toBe(DELEGATE_TOOL_NAME);
    expect(delegation.description).toBe(DELEGATION_DESCRIPTION);
    expect(delegation.parameters.properties).toBe(DELEGATION_PROPERTIES);
    expect(delegation.parameters.required).toBe(DELEGATION_REQUIRED);
  });

  it("contrasts the catalog with a policy-filtered one and states the structured shape", () => {
    expect(CATALOG_DESCRIPTION).toContain("not limited by the Session's authorized model list");
    expect(CATALOG_DESCRIPTION).toContain("providers");
    expect(CATALOG_DESCRIPTION).toContain("efforts");
    expect(CATALOG_DESCRIPTION).toContain("separate arguments");
    expect(Object.keys(CATALOG_PROPERTIES)).toEqual(["provider"]);
    expect(CATALOG_PROPERTIES.provider.description).toContain("omit to list every provider");
  });

  it("states the route-capable delegation and the context trade-offs", () => {
    expect(DELEGATION_DESCRIPTION).toContain("not limited to the Session's authorized model list");
    expect(DELEGATION_DESCRIPTION).toContain("fresh context");
    expect(DELEGATION_DESCRIPTION).toContain("inherit_context: true");
    expect(DELEGATION_DESCRIPTION).toContain("completed turns");
    expect(DELEGATION_DESCRIPTION).toContain("in-flight turn");
    expect(DELEGATION_DESCRIPTION).toContain("selected provider");
    expect(DELEGATION_DESCRIPTION).toContain("inherited prefix");
    expect(DELEGATION_PROPERTIES.model.description).toContain("Omit to run the child on your current route");
    expect(DELEGATION_PROPERTIES.reasoning_effort.description).toContain("Requires `model`");
    expect(DELEGATION_PROPERTIES.reasoning_effort.description).toContain("model default applies");
    expect(DELEGATION_PROPERTIES.model.description).toContain("never a `provider/model` route");
    // An external provider owns execution, so the claim is scoped to what this call resolved.
    expect(DELEGATION_DESCRIPTION).toContain("effort this call resolved and forwarded");
    expect(DELEGATION_DESCRIPTION).toContain("outside this host may apply its own default");
    expect(DELEGATION_DESCRIPTION).not.toContain("effort the child actually runs with");
  });

  it("names the backend and the fresh-context recovery for a pin failure", () => {
    const unpinned = unpinnedChildText("fork");
    expect(unpinned).toContain("fork");
    expect(unpinned).toContain("inherit_context: false");
    const missing = missingModelSeamText("fork");
    expect(missing).toContain("fork");
    expect(missing).toContain("agent.model.select");
    expect(missing).toContain("inherit_context: false");
  });
  it("conditions the pin recovery on a compatible `backends.fresh` backend", () => {
    const unpinned = unpinnedChildText("fork");
    // The failure establishes that the route was not confirmed, not which route runs.
    expect(unpinned).toContain("could not be confirmed on the route this call resolved");
    expect(unpinned).not.toContain("would run the caller route");
    // A registered fresh backend is not enough: it must be the selected, compatible one.
    expect(unpinned).toContain("`backends.fresh` selects a compatible backend");
    expect(unpinned).not.toContain("this composition has a fresh backend");
    const missing = missingModelSeamText("fork");
    // One child without the seam does not establish that the whole host lacks it.
    expect(missing).toContain("the child on backend");
    expect(missing).not.toContain("this host does not expose");
    expect(missing).toContain("`backends.fresh` selects a compatible backend");
  });

  it("does not offer an immediate retry when termination was not confirmed", () => {
    const stopped = unpinnedChildText("fork", { childId: "child-1", stopped: true });
    const running = unpinnedChildText("fork", { childId: "child-1", stopped: false });

    expect(stopped).toContain("the call stopped it");
    // A refused teardown leaves termination unknown, so the message asks rather than asserts.
    expect(running).toContain("termination is unconfirmed rather than known");
    expect(running).toContain("check whether");
    expect(running).not.toContain("so it is still running");
    expect(running).not.toContain("the call stopped it");
  });

  it("names the child the caller can check when termination is unconfirmed", () => {
    const named = unpinnedChildText("fork", { childId: "child-42", stopped: false });
    const unnamed = unpinnedChildText("fork", { stopped: false });

    expect(named).toContain("child-42");
    expect(named).toContain("check whether child child-42 is still running");
    expect(unnamed).toContain("check whether child this call started is still running");
  });

  it("owns the catalog, route, and context-mode diagnostics", () => {
    expect(unknownCatalogProviderText("nope", ["a", "b"]))
      .toBe("LLM provider \"nope\" is not registered; available providers: a, b");
    expect(unknownCatalogProviderText("nope", [])).toContain("(none)");
    expect(PROVIDER_REQUIRES_MODEL_TEXT).toContain("must be supplied together");
    expect(EFFORT_REQUIRES_MODEL_TEXT).toContain("requires `model`");
    expect(NO_PROVIDER_ROUTE_TEXT).toContain("no LLM provider route");
    expect(NO_MODEL_ROUTE_TEXT).toContain("no LLM model route");
    expect(NO_LLM_SERVICE_TEXT).toContain("`llm` service is unavailable");
    expect(missingContextModeText("inherit")).toContain("inherit_context");
    expect(missingBackendText({ mode: "inherit", backend: "fork" }))
      .toContain("inherit_context=true requires the subagent backend \"fork\"");
    expect(contextContractText({ mode: "inherit", backend: "fork", expected: true, actual: false }))
      .toContain("expected inheritsParentContext=true, got false");
    expect(backendOptionsText({ mode: "fresh", backend: "spawn" }))
      .toContain("inherit_context=false");
  });
  it("covers every masked name with a replacement", () => {
    expect(Object.keys(REPLACEMENTS).sort()).toEqual([...MASKED_TOOLS].sort());
  });

  it("carries the parallel-delegation and concurrent-edit rule the native tool rendered", () => {
    const text = guidanceText({ hidden: ["subagent"] });

    expect(text).toContain("Start independent delegations together in one assistant message");
    expect(text).toContain("end your turn instead of polling");
    expect(text).toContain("can overwrite concurrent edits");
    expect(text).toContain("review the final diff and run the relevant tests");
  });

  it("scopes the route claim to the Session policy instead of the whole surface", () => {
    expect(guidanceText({})).toContain("the Session's model-selection policy does not gate");
  });

  it("claims nothing about names the composition never registered", () => {
    const text = guidanceText({ hidden: [], surviving: [], absent: ["workflow"] });

    expect(text).not.toContain("Unavailable");
    expect(text).not.toContain("workflow");
  });

  it("maps every masked name to a replacement", () => {
    expect(REPLACEMENTS).toEqual({
      subagent: DELEGATE_TOOL_NAME,
      subagent_fork: DELEGATE_TOOL_NAME,
      workflow: DELEGATE_TOOL_NAME,
      list_subagent_models: LIST_TOOL_NAME
    });
    expect(refusalText("subagent")).toContain("`subagent_model`");
    expect(refusalText("subagent_fork")).toContain("`subagent_model`");
    expect(refusalText("workflow")).toContain("`subagent_model`");
    expect(refusalText("list_subagent_models")).toContain("`list_subagent_routes`");
    expect(refusalText("subagent")).toContain("unavailable while the dsh-subagent-model plugin is loaded");
  });

  it("renders the depth notice with the remaining budget", () => {
    const notice = depthNotice({ current: 2, maximum: 2 });

    expect(notice).toContain("current 2, maximum 2, remaining levels 0");
    expect(notice).toContain("Do not delegate at this depth");
  });

  it("renders guidance that names the route-capable tool and the recovery path", () => {
    const text = guidanceText({ hidden: ["subagent", "subagent_fork", "list_subagent_models", "workflow"], surviving: [] });

    expect(text).toContain("`subagent_model`");
    expect(text).toContain("`list_subagent_routes`");
    expect(text).toContain("retry it with `subagent_model`");
    expect(text).toContain("Unavailable while this plugin is loaded");
    expect(text).not.toContain("Still visible");
  });

  it("reports a surviving name instead of claiming it is hidden", () => {
    const text = guidanceText({ hidden: ["subagent"], surviving: ["workflow"] });

    expect(text).toContain("Still visible because this composition registers `workflow`");
    expect(text).toContain("the sanitized delegation surface is not guaranteed here");
    expect(text).toContain("Prefer `subagent_model` for any route the Session's model-selection policy does not authorize");
  });

  it("renders the base rule when no availability is known", () => {
    const text = guidanceText({});

    expect(text).toContain("`subagent_model`");
    expect(text).not.toContain("Unavailable");
    expect(text).not.toContain("Still visible");
  });
});
