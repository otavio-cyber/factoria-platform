"use client";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Mesmo domínio do app: baseURL padrão (origem atual).
export const authClient = createAuthClient({ plugins: [adminClient()] });
