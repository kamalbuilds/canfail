/** Production entry point. Everything reachable from here ships to users. */
export { getProducts } from "./api.js";
export { healthCheck } from "./health.js";
export { renderResult } from "./ui/ResultScreen.js";
export { score, verdictFor, containsAllergen } from "./scoring.js";
