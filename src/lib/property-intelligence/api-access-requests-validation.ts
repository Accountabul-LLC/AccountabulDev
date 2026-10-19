// Pure request-boundary validation for the API access request server
// functions (Phase 5 of docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md).

import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

export type SubmitApiAccessRequestInput = {
  email: string;
  organization: string;
  useCase: string;
  monthlyVolume: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSubmitApiAccessRequestInput(input: unknown): SubmitApiAccessRequestInput {
  const data = (input ?? {}) as Record<string, unknown>;

  const email = typeof data["email"] === "string" ? data["email"].trim() : "";
  if (!email || email.length > 320 || !EMAIL.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  const organization = typeof data["organization"] === "string" ? data["organization"].trim() : "";
  if (!organization || organization.length > 200) {
    throw new Error("Tell us your organization.");
  }

  const useCase = typeof data["useCase"] === "string" ? data["useCase"].trim() : "";
  if (!useCase || useCase.length > 2000) {
    throw new Error("Describe your intended use case.");
  }

  const monthlyVolume =
    typeof data["monthlyVolume"] === "string" ? data["monthlyVolume"].trim() : "";
  if (!monthlyVolume || monthlyVolume.length > 120) {
    throw new Error("Give an estimated monthly request volume.");
  }

  return { email, organization, useCase, monthlyVolume };
}

export type ApiAccessRequestStatus = "pending" | "approved" | "denied";

export type ReviewApiAccessRequestInput = {
  requestId: string;
  status: Exclude<ApiAccessRequestStatus, "pending">;
};

/** Admin decision on a request. Authority (has_role) is checked separately. */
export function validateReviewApiAccessRequestInput(input: unknown): ReviewApiAccessRequestInput {
  const data = (input ?? {}) as Record<string, unknown>;
  const requestId = typeof data["requestId"] === "string" ? data["requestId"] : "";
  if (!UUID.test(requestId)) throw new Error("An API access request is required.");

  const status = data["status"];
  if (status !== "approved" && status !== "denied") {
    throw new Error("Choose approved or denied.");
  }

  return { requestId, status };
}
