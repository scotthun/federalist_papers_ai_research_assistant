//@ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js options go here
  // See: https://nextjs.org/docs/app/api-reference/config/next-config-js

  // Don't auto-generate AGENTS.md/CLAUDE.md — this repo already has its own
  // AI-tooling conventions and this story is scaffold-only.
  agentRules: false,
};

module.exports = nextConfig;
