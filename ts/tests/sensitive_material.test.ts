import { describe, expect, it } from "vitest";

import {
  assertNoSensitiveString,
  SensitiveMaterialError,
  validateCredentialHandle,
} from "../src/security/sensitive-material.js";

// Token-shaped strings are assembled at runtime so this source file contains no
// literal secret pattern and stays clean for the public hygiene scan.
const fineGrainedPat = ["github", "pat", "1".repeat(24)].join("_");
const classicPat = `ghp_${"a".repeat(24)}`;

describe("sensitive material guard", () => {
  it("flags GitHub fine-grained and classic tokens", () => {
    expect(() => assertNoSensitiveString(fineGrainedPat, "body")).toThrow(SensitiveMaterialError);
    expect(() => assertNoSensitiveString(classicPat, "body")).toThrow(SensitiveMaterialError);
  });

  it("allows ordinary text", () => {
    expect(() => assertNoSensitiveString("a normal issue comment", "body")).not.toThrow();
  });

  it("rejects a credential handle that embeds a token, accepts a plain handle", () => {
    expect(() => validateCredentialHandle(`cred_${fineGrainedPat}`)).toThrow(
      SensitiveMaterialError,
    );
    expect(() => validateCredentialHandle("cred_github")).not.toThrow();
  });
});
