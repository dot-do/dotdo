/**
 * @dotdo/finance - Stripe provider implementation
 */
import Stripe from 'stripe';
/**
 * Helper to filter out undefined values from an object
 */
function filterUndefined(obj) {
    const result = {};
    for (const key in obj) {
        if (obj[key] !== undefined) {
            result[key] = obj[key];
        }
    }
    return result;
}
/**
 * Stripe implementation of FinancialClient
 */
export class StripeProvider {
    stripe;
    webhookSecret;
    webhookHandlers = new Map();
    constructor(config) {
        this.stripe = new Stripe(config.apiKey);
        this.webhookSecret = config.webhookSecret;
    }
    // Customer operations
    customers = {
        create: async (input) => {
            const params = filterUndefined({
                email: input.email,
                name: input.name,
                metadata: input.metadata,
            });
            const customer = await this.stripe.customers.create(params);
            return this.mapStripeCustomer(customer);
        },
        get: async (id) => {
            try {
                const customer = await this.stripe.customers.retrieve(id);
                if (customer.deleted)
                    return null;
                return this.mapStripeCustomer(customer);
            }
            catch (err) {
                if (err.code === 'resource_missing')
                    return null;
                throw err;
            }
        },
        update: async (id, input) => {
            const params = filterUndefined({
                email: input.email,
                name: input.name,
                metadata: input.metadata,
            });
            const customer = await this.stripe.customers.update(id, params);
            return this.mapStripeCustomer(customer);
        },
        delete: async (id) => {
            await this.stripe.customers.del(id);
        },
        list: async (options) => {
            const params = filterUndefined({
                limit: options?.limit,
                starting_after: options?.startingAfter,
                ending_before: options?.endingBefore,
            });
            const result = await this.stripe.customers.list(params);
            return {
                data: result.data.map((c) => this.mapStripeCustomer(c)),
                hasMore: result.has_more,
            };
        },
    };
    // Subscription operations
    subscriptions = {
        create: async (input) => {
            const item = { price: input.priceId };
            if (input.quantity !== undefined) {
                item.quantity = input.quantity;
            }
            const params = filterUndefined({
                customer: input.customerId,
                items: [item],
                trial_period_days: input.trialPeriodDays,
                metadata: input.metadata,
            });
            const subscription = await this.stripe.subscriptions.create(params);
            return this.mapStripeSubscription(subscription);
        },
        get: async (id) => {
            try {
                const subscription = await this.stripe.subscriptions.retrieve(id);
                return this.mapStripeSubscription(subscription);
            }
            catch (err) {
                if (err.code === 'resource_missing')
                    return null;
                throw err;
            }
        },
        update: async (id, input) => {
            const updateParams = {};
            if (input.cancelAtPeriodEnd !== undefined) {
                updateParams.cancel_at_period_end = input.cancelAtPeriodEnd;
            }
            if (input.metadata !== undefined) {
                updateParams.metadata = input.metadata;
            }
            if (input.priceId !== undefined || input.quantity !== undefined) {
                const current = await this.stripe.subscriptions.retrieve(id);
                const firstItem = current.items.data[0];
                if (firstItem) {
                    const itemUpdate = {
                        id: firstItem.id,
                    };
                    if (input.priceId !== undefined) {
                        itemUpdate.price = input.priceId;
                    }
                    if (input.quantity !== undefined) {
                        itemUpdate.quantity = input.quantity;
                    }
                    updateParams.items = [itemUpdate];
                }
            }
            const subscription = await this.stripe.subscriptions.update(id, updateParams);
            return this.mapStripeSubscription(subscription);
        },
        cancel: async (id, cancelAtPeriodEnd = true) => {
            let subscription;
            if (cancelAtPeriodEnd) {
                subscription = await this.stripe.subscriptions.update(id, {
                    cancel_at_period_end: true,
                });
            }
            else {
                subscription = await this.stripe.subscriptions.cancel(id);
            }
            return this.mapStripeSubscription(subscription);
        },
        list: async (options) => {
            const params = filterUndefined({
                customer: options?.customerId,
                limit: options?.limit,
                starting_after: options?.startingAfter,
                ending_before: options?.endingBefore,
            });
            const result = await this.stripe.subscriptions.list(params);
            return {
                data: result.data.map((s) => this.mapStripeSubscription(s)),
                hasMore: result.has_more,
            };
        },
    };
    // Invoice operations
    invoices = {
        create: async (input) => {
            const params = filterUndefined({
                customer: input.customerId,
                auto_advance: input.autoAdvance,
                collection_method: input.collectionMethod,
                days_until_due: input.daysUntilDue,
                metadata: input.metadata,
            });
            const invoice = await this.stripe.invoices.create(params);
            return this.mapStripeInvoice(invoice);
        },
        get: async (id) => {
            try {
                const invoice = await this.stripe.invoices.retrieve(id);
                return this.mapStripeInvoice(invoice);
            }
            catch (err) {
                if (err.code === 'resource_missing')
                    return null;
                throw err;
            }
        },
        list: async (options) => {
            const params = filterUndefined({
                customer: options?.customerId,
                subscription: options?.subscriptionId,
                limit: options?.limit,
                starting_after: options?.startingAfter,
                ending_before: options?.endingBefore,
            });
            const result = await this.stripe.invoices.list(params);
            return {
                data: result.data.map((i) => this.mapStripeInvoice(i)),
                hasMore: result.has_more,
            };
        },
        pay: async (id) => {
            const invoice = await this.stripe.invoices.pay(id);
            return this.mapStripeInvoice(invoice);
        },
        finalize: async (id) => {
            const invoice = await this.stripe.invoices.finalizeInvoice(id);
            return this.mapStripeInvoice(invoice);
        },
        void: async (id) => {
            const invoice = await this.stripe.invoices.voidInvoice(id);
            return this.mapStripeInvoice(invoice);
        },
    };
    // Payment operations
    payments = {
        create: async (input) => {
            const params = filterUndefined({
                amount: input.amount,
                currency: input.currency,
                customer: input.customerId,
                payment_method: input.paymentMethod,
                confirm: input.confirm,
                metadata: input.metadata,
            });
            const paymentIntent = await this.stripe.paymentIntents.create(params);
            return this.mapStripePaymentIntent(paymentIntent);
        },
        get: async (id) => {
            try {
                const paymentIntent = await this.stripe.paymentIntents.retrieve(id);
                return this.mapStripePaymentIntent(paymentIntent);
            }
            catch (err) {
                if (err.code === 'resource_missing')
                    return null;
                throw err;
            }
        },
        list: async (options) => {
            const params = filterUndefined({
                customer: options?.customerId,
                limit: options?.limit,
                starting_after: options?.startingAfter,
                ending_before: options?.endingBefore,
            });
            const result = await this.stripe.paymentIntents.list(params);
            return {
                data: result.data.map((p) => this.mapStripePaymentIntent(p)),
                hasMore: result.has_more,
            };
        },
        refund: async (id, amount) => {
            const params = filterUndefined({
                payment_intent: id,
                amount,
            });
            await this.stripe.refunds.create(params);
            const paymentIntent = await this.stripe.paymentIntents.retrieve(id);
            return this.mapStripePaymentIntent(paymentIntent);
        },
    };
    // SaaS metrics
    metrics = {
        getMRR: async () => {
            // Calculate MRR from active subscriptions
            let mrr = 0;
            let hasMore = true;
            let startingAfter;
            while (hasMore) {
                const params = {
                    status: 'active',
                    limit: 100,
                };
                if (startingAfter) {
                    params.starting_after = startingAfter;
                }
                const result = await this.stripe.subscriptions.list(params);
                for (const sub of result.data) {
                    const firstItem = sub.items.data[0];
                    if (firstItem?.price) {
                        const price = firstItem.price;
                        const quantity = firstItem.quantity ?? 1;
                        const unitAmount = price.unit_amount ?? 0;
                        // Normalize to monthly
                        if (price.recurring?.interval === 'month') {
                            mrr += unitAmount * quantity;
                        }
                        else if (price.recurring?.interval === 'year') {
                            mrr += Math.round((unitAmount * quantity) / 12);
                        }
                        else if (price.recurring?.interval === 'week') {
                            mrr += Math.round((unitAmount * quantity * 52) / 12);
                        }
                        else if (price.recurring?.interval === 'day') {
                            mrr += Math.round((unitAmount * quantity * 365) / 12);
                        }
                    }
                }
                hasMore = result.has_more;
                const lastItem = result.data[result.data.length - 1];
                startingAfter = lastItem?.id;
            }
            return mrr;
        },
        getARR: async () => {
            const mrr = await this.metrics.getMRR();
            return mrr * 12;
        },
        getSaaSMetrics: async () => {
            const mrr = await this.metrics.getMRR();
            // Count active subscriptions
            const subsResult = await this.stripe.subscriptions.list({
                status: 'active',
                limit: 1,
            });
            // Count total customers
            const customersResult = await this.stripe.customers.list({
                limit: 1,
            });
            return {
                mrr,
                arr: mrr * 12,
                activeSubscriptions: subsResult.data.length > 0 ? (await this.countActiveSubscriptions()) : 0,
                totalCustomers: customersResult.data.length > 0 ? (await this.countCustomers()) : 0,
                currency: 'usd',
                calculatedAt: new Date(),
            };
        },
        getMRRBreakdown: async (_periodStart, _periodEnd) => {
            // This would require tracking historical subscription data
            // For now, return a stub
            throw new Error('getMRRBreakdown not implemented - requires historical data tracking');
        },
    };
    // Webhook handling
    webhooks = {
        handleWebhook: async (payload, signature) => {
            if (!this.webhookSecret) {
                throw new Error('Webhook secret not configured');
            }
            const event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
            const webhookEvent = this.mapStripeEvent(event);
            // Call registered handlers
            const eventType = webhookEvent.type;
            const handlers = this.webhookHandlers.get(eventType);
            if (handlers) {
                for (const handler of handlers) {
                    await handler(webhookEvent);
                }
            }
            return webhookEvent;
        },
        on: (eventType, handler) => {
            if (!this.webhookHandlers.has(eventType)) {
                this.webhookHandlers.set(eventType, new Set());
            }
            this.webhookHandlers.get(eventType).add(handler);
        },
        off: (eventType, handler) => {
            const handlers = this.webhookHandlers.get(eventType);
            if (handlers) {
                handlers.delete(handler);
            }
        },
    };
    // Helper methods for counting (avoiding Stripe's expensive count API)
    async countActiveSubscriptions() {
        let count = 0;
        let hasMore = true;
        let startingAfter;
        while (hasMore) {
            const params = {
                status: 'active',
                limit: 100,
            };
            if (startingAfter) {
                params.starting_after = startingAfter;
            }
            const result = await this.stripe.subscriptions.list(params);
            count += result.data.length;
            hasMore = result.has_more;
            const lastItem = result.data[result.data.length - 1];
            startingAfter = lastItem?.id;
        }
        return count;
    }
    async countCustomers() {
        let count = 0;
        let hasMore = true;
        let startingAfter;
        while (hasMore) {
            const params = {
                limit: 100,
            };
            if (startingAfter) {
                params.starting_after = startingAfter;
            }
            const result = await this.stripe.customers.list(params);
            count += result.data.length;
            hasMore = result.has_more;
            const lastItem = result.data[result.data.length - 1];
            startingAfter = lastItem?.id;
        }
        return count;
    }
    // Mapping functions
    mapStripeCustomer(customer) {
        const result = {
            id: customer.id,
            email: customer.email ?? '',
            createdAt: new Date(customer.created * 1000),
            updatedAt: new Date(customer.created * 1000), // Stripe doesn't track updated_at
        };
        if (customer.name != null) {
            result.name = customer.name;
        }
        if (customer.metadata && Object.keys(customer.metadata).length > 0) {
            result.metadata = customer.metadata;
        }
        return result;
    }
    mapStripeSubscription(subscription) {
        const firstItem = subscription.items.data[0];
        const result = {
            id: subscription.id,
            customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
            status: subscription.status,
            priceId: firstItem?.price.id ?? '',
            productId: typeof firstItem?.price.product === 'string' ? firstItem.price.product : firstItem?.price.product?.id ?? '',
            quantity: firstItem?.quantity ?? 1,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            createdAt: new Date(subscription.created * 1000),
            updatedAt: new Date(subscription.created * 1000),
        };
        if (subscription.canceled_at != null) {
            result.canceledAt = new Date(subscription.canceled_at * 1000);
        }
        if (subscription.ended_at != null) {
            result.endedAt = new Date(subscription.ended_at * 1000);
        }
        if (subscription.trial_start != null) {
            result.trialStart = new Date(subscription.trial_start * 1000);
        }
        if (subscription.trial_end != null) {
            result.trialEnd = new Date(subscription.trial_end * 1000);
        }
        if (subscription.metadata && Object.keys(subscription.metadata).length > 0) {
            result.metadata = subscription.metadata;
        }
        return result;
    }
    mapStripeInvoice(invoice) {
        const result = {
            id: invoice.id ?? '',
            customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? '',
            status: (invoice.status ?? 'draft'),
            currency: invoice.currency,
            amountDue: invoice.amount_due,
            amountPaid: invoice.amount_paid,
            amountRemaining: invoice.amount_remaining,
            subtotal: invoice.subtotal,
            total: invoice.total,
            createdAt: new Date(invoice.created * 1000),
        };
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (subscriptionId != null) {
            result.subscriptionId = subscriptionId;
        }
        if (invoice.tax != null) {
            result.tax = invoice.tax;
        }
        if (invoice.hosted_invoice_url != null) {
            result.hostedInvoiceUrl = invoice.hosted_invoice_url;
        }
        if (invoice.invoice_pdf != null) {
            result.invoicePdf = invoice.invoice_pdf;
        }
        if (invoice.due_date != null) {
            result.dueDate = new Date(invoice.due_date * 1000);
        }
        if (invoice.status_transitions?.paid_at != null) {
            result.paidAt = new Date(invoice.status_transitions.paid_at * 1000);
        }
        if (invoice.period_start != null) {
            result.periodStart = new Date(invoice.period_start * 1000);
        }
        if (invoice.period_end != null) {
            result.periodEnd = new Date(invoice.period_end * 1000);
        }
        if (invoice.metadata && Object.keys(invoice.metadata).length > 0) {
            result.metadata = invoice.metadata;
        }
        return result;
    }
    mapStripePaymentIntent(paymentIntent) {
        const result = {
            id: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            status: this.mapPaymentIntentStatus(paymentIntent.status),
            createdAt: new Date(paymentIntent.created * 1000),
        };
        const customerId = typeof paymentIntent.customer === 'string' ? paymentIntent.customer : paymentIntent.customer?.id;
        if (customerId != null) {
            result.customerId = customerId;
        }
        const invoiceId = typeof paymentIntent.invoice === 'string' ? paymentIntent.invoice : paymentIntent.invoice?.id;
        if (invoiceId != null) {
            result.invoiceId = invoiceId;
        }
        const paymentMethod = typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : paymentIntent.payment_method?.id;
        if (paymentMethod != null) {
            result.paymentMethod = paymentMethod;
        }
        if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== 'string' && paymentIntent.latest_charge.receipt_url != null) {
            result.receiptUrl = paymentIntent.latest_charge.receipt_url;
        }
        if (paymentIntent.last_payment_error?.message != null) {
            result.failureMessage = paymentIntent.last_payment_error.message;
        }
        if (paymentIntent.metadata && Object.keys(paymentIntent.metadata).length > 0) {
            result.metadata = paymentIntent.metadata;
        }
        return result;
    }
    mapPaymentIntentStatus(status) {
        switch (status) {
            case 'succeeded':
                return 'succeeded';
            case 'processing':
                return 'pending';
            case 'canceled':
                return 'canceled';
            case 'requires_action':
                return 'requires_action';
            case 'requires_payment_method':
                return 'requires_payment_method';
            default:
                return 'pending';
        }
    }
    mapStripeEvent(event) {
        return {
            id: event.id,
            type: this.mapStripeEventType(event.type),
            data: event.data.object,
            createdAt: new Date(event.created * 1000),
            livemode: event.livemode,
        };
    }
    mapStripeEventType(type) {
        // Map Stripe event types to our webhook event types
        const mapping = {
            'customer.created': 'customer.created',
            'customer.updated': 'customer.updated',
            'customer.deleted': 'customer.deleted',
            'customer.subscription.created': 'subscription.created',
            'customer.subscription.updated': 'subscription.updated',
            'customer.subscription.deleted': 'subscription.deleted',
            'customer.subscription.trial_will_end': 'subscription.trial_will_end',
            'invoice.created': 'invoice.created',
            'invoice.paid': 'invoice.paid',
            'invoice.payment_failed': 'invoice.payment_failed',
            'invoice.finalized': 'invoice.finalized',
            'payment_intent.succeeded': 'payment.succeeded',
            'payment_intent.payment_failed': 'payment.failed',
            'charge.refunded': 'payment.refunded',
        };
        return mapping[type] ?? 'customer.updated';
    }
}
//# sourceMappingURL=stripe-provider.js.map