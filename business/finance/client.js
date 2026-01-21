/**
 * @dotdo/finance - Financial client interface
 */
import { StripeProvider } from './providers/stripe-provider';
/**
 * Create a Stripe-backed financial client
 */
export function createStripeClient(config) {
    return new StripeProvider(config);
}
//# sourceMappingURL=client.js.map