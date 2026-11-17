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
  refusalText
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

  it("contrasts the catalog with a policy-filtered one", () => {
    expect(CATALOG_DESCRIPTION).toContain("not limited by the Session's authorized model list");
    expect(CATALOG_PROPERTIES.model.description).toContain("requires provider");
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
    expect(DELEGATION_PROPERTIES.reasoning_effort.description).toContain("requires `model`");
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
