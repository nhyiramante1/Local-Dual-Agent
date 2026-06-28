import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig, resolveManagerBudget } from "../src/config.js";

async function withToml<T>(
  content: string,
  fn: (tomlPath: string) => Promise<T> | T,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "duet-config-test-"));
  try {
    const tomlPath = path.join(dir, "duet.toml");
    await writeFile(tomlPath, content);
    await fn(tomlPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadConfig returns default manager budget fields when [manager] is absent", async () => {
  await withToml("", async (tomlPath) => {
    const config = await loadConfig(tomlPath);
    const budget = resolveManagerBudget(config);
    assert.equal(budget.claudeMaxUsdPerTurn, 0.5);
    assert.equal(budget.claudeMaxUsdPerDay, 5);
    assert.equal(budget.codexMaxInputTokensPerDay, 500_000);
    assert.equal(budget.codexMaxOutputTokensPerDay, 100_000);
    assert.equal(budget.codexMaxRuntimeSeconds, 120);
    assert.equal(budget.maxTurnsPerDay, 200);
  });
});

test("loadConfig reads custom [manager] values from TOML", async () => {
  await withToml(
    `
[manager]
claude_max_usd_per_turn = 0.25
claude_max_usd_per_day = 2.0
max_turns_per_day = 50
codex_max_input_tokens_per_day = 100000
codex_max_output_tokens_per_day = 20000
codex_runtime_seconds = 60
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      const budget = resolveManagerBudget(config);
      assert.equal(budget.claudeMaxUsdPerTurn, 0.25);
      assert.equal(budget.claudeMaxUsdPerDay, 2.0);
      assert.equal(budget.maxTurnsPerDay, 50);
      assert.equal(budget.codexMaxInputTokensPerDay, 100_000);
      assert.equal(budget.codexMaxOutputTokensPerDay, 20_000);
      assert.equal(budget.codexMaxRuntimeSeconds, 60);
    },
  );
});

test("loadConfig partial [manager] section merges with defaults", async () => {
  await withToml(
    `
[manager]
max_turns_per_day = 100
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      const budget = resolveManagerBudget(config);
      assert.equal(budget.maxTurnsPerDay, 100);
      assert.equal(budget.claudeMaxUsdPerTurn, 0.5);
      assert.equal(budget.claudeMaxUsdPerDay, 5);
    },
  );
});

test("loadConfig returns balanced profile when [orchestration] has no profile", async () => {
  await withToml("", async (tomlPath) => {
    const config = await loadConfig(tomlPath);
    assert.equal(config.orchestration.profile, "balanced");
  });
});

test("loadConfig reads profile from [orchestration]", async () => {
  await withToml(
    `
[orchestration]
profile = "reasoning"
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.orchestration.profile, "reasoning");
    },
  );
});

test("loadConfig falls back to balanced for unrecognised profile", async () => {
  await withToml(
    `
[orchestration]
profile = "turbo-mode"
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.orchestration.profile, "balanced");
    },
  );
});

test("loadConfig returns groq as default manager provider when [manager] is absent", async () => {
  await withToml("", async (tomlPath) => {
    const config = await loadConfig(tomlPath);
    assert.equal(config.manager.provider, "groq");
    assert.equal(config.manager.groqModel, "openai/gpt-oss-120b");
    assert.equal(config.manager.geminiModel, "gemini-3.1-flash-lite");
    assert.equal(config.manager.providers.glm.label, "GLM");
    assert.equal(config.manager.providers.glm.apiKeyEnv, "ZAI_API_KEY");
    assert.deepEqual(config.manager.providers.glm.apiKeyEnvs, ["ZAI_API_KEY", "ZAP_API_KEY", "ZHIPU_API_KEY"]);
    assert.equal(config.manager.providers.glm.model, "glm-4.5-flash");
  });
});

test("loadConfig reads manager provider = gemini from TOML", async () => {
  await withToml(
    `
[manager]
provider = "gemini"
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.manager.provider, "gemini");
    },
  );
});

test("loadConfig reads manager provider = openai from TOML", async () => {
  await withToml(
    `
[manager]
provider = "openai"
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.manager.provider, "openai");
    },
  );
});

test("loadConfig reads dynamic manager provider profiles from TOML", async () => {
  await withToml(
    `
[manager]
provider = "glm"

[manager.providers.kimi]
label = "Kimi"
api_key_env = "KIMI_API_KEY"
api_key_envs = ["KIMI_API_KEY", "MOONSHOT_API_KEY"]
model_env = "KIMI_MODEL"
base_url_env = "KIMI_BASE_URL"
model = "kimi-k2"
base_url = "https://api.moonshot.ai/v1"
native_tool_calling = true
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.manager.provider, "glm");
      assert.equal(config.manager.providers.kimi.label, "Kimi");
      assert.equal(config.manager.providers.kimi.apiKeyEnv, "KIMI_API_KEY");
      assert.deepEqual(config.manager.providers.kimi.apiKeyEnvs, ["KIMI_API_KEY", "MOONSHOT_API_KEY"]);
      assert.equal(config.manager.providers.kimi.modelEnv, "KIMI_MODEL");
      assert.equal(config.manager.providers.kimi.baseUrlEnv, "KIMI_BASE_URL");
      assert.equal(config.manager.providers.kimi.model, "kimi-k2");
      assert.equal(config.manager.providers.kimi.baseUrl, "https://api.moonshot.ai/v1");
    },
  );
});

test("loadConfig accepts dynamic provider api_key_envs without api_key_env", async () => {
  await withToml(
    `
[manager.providers.altglm]
label = "Alt GLM"
api_key_envs = ["ZAP_API_KEY", "ZAI_API_KEY"]
model = "glm-4.5-flash"
base_url = "https://api.z.ai/api/paas/v4"
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.manager.providers.altglm.apiKeyEnv, "ZAP_API_KEY");
      assert.deepEqual(config.manager.providers.altglm.apiKeyEnvs, ["ZAP_API_KEY", "ZAI_API_KEY"]);
    },
  );
});

test("loadConfig falls back to the default for unrecognised manager provider", async () => {
  await withToml(
    `
[manager]
provider = "gpt-wizard"
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.manager.provider, "groq");
    },
  );
});

test("loadConfig reads openai_model and openai budget fields", async () => {
  await withToml(
    `
[manager]
provider = "openai"
openai_model = "gpt-4o"
openai_max_usd_per_turn = 0.20
openai_max_usd_per_day = 5.0
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.manager.openaiModel, "gpt-4o");
      const budget = resolveManagerBudget(config);
      assert.equal(budget.openaiMaxUsdPerTurn, 0.20);
      assert.equal(budget.openaiMaxUsdPerDay, 5.0);
    },
  );
});

test("loadConfig reads groq and gemini manager model presets", async () => {
  await withToml(
    `
[manager]
groq_model = "qwen/qwen3-32b"
groq_base_url = "https://api.groq.com/openai/v1"
gemini_model = "gemini-3.5-flash"
gemini_base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.manager.groqModel, "qwen/qwen3-32b");
      assert.equal(config.manager.groqBaseUrl, "https://api.groq.com/openai/v1");
      assert.equal(config.manager.geminiModel, "gemini-3.5-flash");
      assert.equal(config.manager.geminiBaseUrl, "https://generativelanguage.googleapis.com/v1beta/openai/");
    },
  );
});

test("loadConfig reads manager tool capability fields", async () => {
  await withToml(
    `
[manager]
native_tool_calling = false
action_mode = "experimental"
supports_multi_step_tool_loop = false
supports_agent_consultation = false
latency_tier = "fast"
max_tool_calls_per_turn = 3
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.manager.nativeToolCalling, false);
      assert.equal(config.manager.actionMode, "experimental");
      assert.equal(config.manager.supportsMultiStepToolLoop, false);
      assert.equal(config.manager.supportsAgentConsultation, false);
      assert.equal(config.manager.latencyTier, "fast");
      assert.equal(config.manager.maxToolCallsPerTurn, 3);
      const budget = resolveManagerBudget(config);
      assert.equal("nativeToolCalling" in budget, false);
      assert.equal("actionMode" in budget, false);
    },
  );
});

test("loadConfig reads fixed service port and persistent dashboard access mode", async () => {
  await withToml(
    `
[service]
host = "0.0.0.0"
port = 58208

[dashboard]
persistent_access = true
public_host = "192.168.1.50"
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      assert.equal(config.service.host, "0.0.0.0");
      assert.equal(config.service.port, 58208);
      assert.equal(config.dashboard.persistentAccess, true);
      assert.equal(config.dashboard.publicHost, "192.168.1.50");
    },
  );
});

test("loadConfig rejects [manager] values below minimum", async () => {
  await withToml(
    `
[manager]
claude_max_usd_per_turn = 0.001
`,
    async (tomlPath) => {
      await assert.rejects(
        () => loadConfig(tomlPath),
        (error: Error) => {
          assert.ok(error.message.includes("0.01"));
          return true;
        },
      );
    },
  );
});
