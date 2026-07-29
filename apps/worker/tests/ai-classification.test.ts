import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readAiClassificationTimeoutMs } from "../src/ai-classification";

describe("readAiClassificationTimeoutMs", () => {
  it("uses 20000 when AI_CLASSIFICATION_TIMEOUT_MS is missing", () => {
    assert.equal(readAiClassificationTimeoutMs({}), 20000);
  });

  it("uses the configured value when it is valid", () => {
    assert.equal(
      readAiClassificationTimeoutMs({
        AI_CLASSIFICATION_TIMEOUT_MS: "45000"
      }),
      45000
    );
  });

  it("uses 20000 when the value is lower than 5000", () => {
    assert.equal(
      readAiClassificationTimeoutMs({
        AI_CLASSIFICATION_TIMEOUT_MS: "4999"
      }),
      20000
    );
  });

  it("uses 20000 when the value is higher than 120000", () => {
    assert.equal(
      readAiClassificationTimeoutMs({
        AI_CLASSIFICATION_TIMEOUT_MS: "120001"
      }),
      20000
    );
  });

  it("uses 20000 when the value is not an integer", () => {
    assert.equal(
      readAiClassificationTimeoutMs({
        AI_CLASSIFICATION_TIMEOUT_MS: "not-a-number"
      }),
      20000
    );
  });
});
