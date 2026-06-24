import { handleSpaAssetRequest } from '../src/platform/cloudflareSpaFallback.js'

export default {
  fetch(request, env) {
    return handleSpaAssetRequest(request, env.ASSETS)
  },
}
