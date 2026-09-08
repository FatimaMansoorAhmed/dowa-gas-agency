/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker deploy (see /Dockerfile) copies just .next/standalone + .next/static
  // into the runtime image instead of the full node_modules tree.
  output: "standalone",
};
module.exports = nextConfig;
