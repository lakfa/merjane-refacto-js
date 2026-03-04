/* eslint-disable no-await-in-loop */
import {eq} from 'drizzle-orm';
import {type ProductService} from './product.service.js';
import {orders, products} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

export class OrderService {
	public constructor(
		private readonly deps: {
			db: Database;
			productService: ProductService;
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

		for (const {product: production} of order.products) {
			switch (production.type) {
				case 'NORMAL': {
					if (production.available > 0) {
						production.available -= 1;
						await this.deps.db.update(products).set(production).where(eq(products.id, production.id));
					} else if (production.leadTime > 0) {
						await this.deps.productService.notifyDelay(production.leadTime, production);
					}

					break;
				}

				case 'SEASONAL': {
					const now = new Date();
					if (now > production.seasonStartDate! && now < production.seasonEndDate! && production.available > 0) {
						production.available -= 1;
						await this.deps.db.update(products).set(production).where(eq(products.id, production.id));
					} else {
						await this.deps.productService.handleSeasonalProduct(production);
					}

					break;
				}

				case 'EXPIRABLE': {
					const now = new Date();
					if (production.available > 0 && production.expiryDate! > now) {
						production.available -= 1;
						await this.deps.db.update(products).set(production).where(eq(products.id, production.id));
					} else {
						await this.deps.productService.handleExpiredProduct(production);
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
