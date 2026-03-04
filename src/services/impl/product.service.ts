import {type Cradle} from '@fastify/awilix';
import {eq} from 'drizzle-orm';
import {type INotificationService} from '../notifications.port.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

export class ProductService {
	private readonly notificationService: INotificationService;
	private readonly db: Database;

	public constructor({notificationService, db}: Pick<Cradle, 'notificationService' | 'db'>) {
		this.notificationService = notificationService;
		this.db = db;
	}

	public async notifyDelay(leadTime: number, product: Product): Promise<void> {
		product.leadTime = leadTime;
		await this.persist(product);
		this.notificationService.sendDelayNotification(leadTime, product.name);
	}

	public async handleSeasonalProduct(product: Product): Promise<void> {
		const currentDate = new Date();
		const ONE_DAY_IN_MS = 1000 * 60 * 60 * 24;
		const restockDate = new Date(
			currentDate.getTime() + (product.leadTime * ONE_DAY_IN_MS),
		);
		if (restockDate > product.seasonEndDate!) {
			this.notificationService.sendOutOfStockNotification(product.name);
			product.available = 0;
			await this.persist(product);
		} else if (product.seasonStartDate! > currentDate) {
			this.notificationService.sendOutOfStockNotification(product.name);
			await this.persist(product);
		} else {
			await this.notifyDelay(product.leadTime, product);
		}
	}

	public async handleExpiredProduct(product: Product): Promise<void> {
		const currentDate = new Date();
		if (product.available > 0 && product.expiryDate! > currentDate) {
			product.available -= 1;
			await this.persist(product);
		} else {
			this.notificationService.sendExpirationNotification(product.name, product.expiryDate!);
			product.available = 0;
			await this.persist(product);
		}
	}

	private async persist(product: Product): Promise<void> {
		await this.db.update(products).set(product).where(eq(products.id, product.id));
	}
}
