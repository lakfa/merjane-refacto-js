/* eslint-disable no-await-in-loop */
import {eq} from 'drizzle-orm';
import {type ProductService} from './product.service.js';
import {orders, products} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

export class OrderService {
	public constructor(
		private readonly deps: {
			db: Database;
			ps: ProductService;
		},
	) {}

	public async processOrder(orderId: number): Promise<void> {
		const order = await this.deps.db.query.orders.findFirst({
			where: eq(orders.id, orderId),
			with: {
				products: {
					columns: {},
					with: {
						product: true,
					},
				},
			},
		});

		if (!order?.products) {
			return;
		}

		for (const {product: p} of order.products) {
			switch (p.type) {
				case 'NORMAL': {
					if (p.available > 0) {
						p.available -= 1;
						await this.deps.db.update(products).set(p).where(eq(products.id, p.id));
					} else if (p.leadTime > 0) {
						await this.deps.ps.notifyDelay(p.leadTime, p);
					}

					break;
				}

				case 'SEASONAL': {
					const now = new Date();
					if (now > p.seasonStartDate! && now < p.seasonEndDate! && p.available > 0) {
						p.available -= 1;
						await this.deps.db.update(products).set(p).where(eq(products.id, p.id));
					} else {
						await this.deps.ps.handleSeasonalProduct(p);
					}

					break;
				}

				case 'EXPIRABLE': {
					const now = new Date();
					if (p.available > 0 && p.expiryDate! > now) {
						p.available -= 1;
						await this.deps.db.update(products).set(p).where(eq(products.id, p.id));
					} else {
						await this.deps.ps.handleExpiredProduct(p);
					}

					break;
				}

				default: {
					break;
				}
			}
		}
	}
}
