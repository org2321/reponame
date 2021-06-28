import { secureRandomAlphanumeric } from "../crypto";

export const generateDeploymentTag = () =>
  secureRandomAlphanumeric(10).toLowerCase();
export const generateSubdomain = () =>
  secureRandomAlphanumeric(10).toLowerCase();
