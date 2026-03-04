import {
	describe, it, expect, beforeEach,
	afterEach,
	vi,
} from 'vitest';
import {mockDeep, type DeepMockProxy} from 'vitest-mock-extended';
import {type INotificationService} from '../notifications.port.js';
import {createDatabaseMock, cleanUp} from '../../utils/test-utils/database-tools.ts.js';
import {ProductService} from './product.service.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

describe('ProductService Tests', () => {
	let notificationServiceMock: DeepMockProxy<INotificationService>;
	let productService: ProductService;
	let databaseMock: Database;
	let databaseName: string;
	let closeDatabase: () => void;

	beforeEach(async () => {
		({databaseMock, databaseName, close: closeDatabase} = await createDatabaseMock());
		notificationServiceMock = mockDeep<INotificationService>();
		productService = new ProductService({
			ns: notificationServiceMock,
			db: databaseMock,
		});
	});

	afterEach(async () => {
		closeDatabase();
		await cleanUp(databaseName);
	});

	it('should handle delay notification correctly', async () => {
		// GIVEN
		const product: Product = {
			id: 1,
			leadTime: 15,
			available: 0,
			type: 'NORMAL',
			name: 'RJ45 Cable',
			expiryDate: null,
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.notifyDelay(product.leadTime, product);

		// THEN
		expect(product.available).toBe(0);
		expect(product.leadTime).toBe(15);
		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(product.leadTime, product.name);
		const result = await databaseMock.query.products.findFirst({
			where: (product, {eq}) => eq(product.id, product.id),
		});
		expect(result).toEqual(product);
	});
	it('handleSeasonalProduct: should notify out-of-stock and set available=0 when restock is after season end', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-20T00:00:00Z')); // Within season, close to end

		// GIVEN: out of stock, leadTime pushes restock after season end
		const product: Product = {
			id: 2,
			leadTime: 20, // Restock 10 Dec > 30 Nov
			available: 0,
			type: 'SEASONAL',
			name: 'Pumpkin Spice Latte',
			expiryDate: null,
			seasonStartDate: new Date('2026-09-01T00:00:00Z'),
			seasonEndDate: new Date('2026-11-30T00:00:00Z'),
		};
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.handleSeasonalProduct(product);

		// THEN
		expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith(product.name);

		const result = await databaseMock.query.products.findFirst({
			where: (p, {eq}) => eq(p.id, product.id),
		});

		expect(result?.available).toBe(0);

		vi.useRealTimers();
	});

	it('handleSeasonalProduct: should notify out-of-stock when current date is before season start', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-15T00:00:00Z')); // Before season start (Sep 1)

		// GIVEN
		const product: Product = {
			id: 3,
			leadTime: 5,
			available: 0,
			type: 'SEASONAL',
			name: 'Pumpkin Spice Latte',
			expiryDate: null,
			seasonStartDate: new Date('2026-09-01T00:00:00Z'),
			seasonEndDate: new Date('2026-11-30T00:00:00Z'),
		};
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.handleSeasonalProduct(product);

		// THEN (legacy behavior: notify + update DB, no forced available change)
		expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith(product.name);

		const result = await databaseMock.query.products.findFirst({
			where: (p, {eq}) => eq(p.id, product.id),
		});

		// Should still exist and match current available
		expect(result?.available).toBe(0);

		vi.useRealTimers();
	});

	it('handleSeasonalProduct: should call notifyDelay when restock is within season and season already started', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-01T00:00:00Z')); // In season

		// GIVEN
		const product: Product = {
			id: 4,
			leadTime: 5, // Restock Oct 6 <= Nov 30
			available: 0,
			type: 'SEASONAL',
			name: 'Pumpkin Spice Latte',
			expiryDate: null,
			seasonStartDate: new Date('2026-09-01T00:00:00Z'),
			seasonEndDate: new Date('2026-11-30T00:00:00Z'),
		};
		await databaseMock.insert(products).values(product);

		const spy = vi.spyOn(productService, 'notifyDelay');

		// WHEN
		await productService.handleSeasonalProduct(product);

		// THEN
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith(product.leadTime, product);

		vi.useRealTimers();
	});

	it('handleExpiredProduct: should decrement available by 1 when not expired and available > 0', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-03T00:00:00Z'));

		// GIVEN
		const product: Product = {
			id: 5,
			leadTime: 3,
			available: 2,
			type: 'EXPIRABLE',
			name: 'Yogurt',
			expiryDate: new Date('2026-03-10T00:00:00Z'),
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.handleExpiredProduct(product);

		// THEN
		expect(notificationServiceMock.sendExpirationNotification).not.toHaveBeenCalled();

		const result = await databaseMock.query.products.findFirst({
			where: (p, {eq}) => eq(p.id, product.id),
		});

		expect(result?.available).toBe(1);

		vi.useRealTimers();
	});

	it('handleExpiredProduct: should notify expiration and set available=0 when expired', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-03T00:00:00Z'));

		// GIVEN
		const product: Product = {
			id: 6,
			leadTime: 3,
			available: 2,
			type: 'EXPIRABLE',
			name: 'Yogurt',
			expiryDate: new Date('2026-03-01T00:00:00Z'), // Expired
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.handleExpiredProduct(product);

		// THEN
		expect(notificationServiceMock.sendExpirationNotification).toHaveBeenCalledWith(product.name, product.expiryDate);

		const result = await databaseMock.query.products.findFirst({
			where: (p, {eq}) => eq(p.id, product.id),
		});

		expect(result?.available).toBe(0);

		vi.useRealTimers();
	});
});

