import { spouseVisa } from "./spouse-visa";
import { visitVisa } from "./visit-visa";
import { skilledWorker } from "./skilled-worker";
import { skilledWorkerDependant } from "./skilled-worker-dependant";
import { ilr } from "./ilr";
import { citizenship } from "./citizenship";
import { sponsorLicence } from "./sponsor-licence";
import { appeal } from "./appeal";

/** Every visa route the firm offers. Seeds new firms; `npm run init:production` adds any that are missing. */
export const allRoutes = [spouseVisa, visitVisa, skilledWorker, skilledWorkerDependant, ilr, citizenship, sponsorLicence, appeal];
