import { Context, Contract } from 'fabric-contract-api'
import stringify from 'json-stringify-deterministic'

const COUPONTYPE = "COUPONTYPE";
const COUPON = "COUPON";
const SHOP = "SHOP";
const CUSTOMER = "CUSTOMER";

export class CryptoLoyality extends Contract {
    serialize: CLSerialize = new CLSerialize();

    constructor() {
        super("CryptoLoyality");
    }

    async instantiate() {
        // function that will be invoked on chaincode instantiation
        console.log("'instantiate' was called.");
      }

    async ping(ctx: Context) {
        return "pong";
    }

    async shopExists(ctx: Context, id: string) {
        const key = ctx.stub.createCompositeKey(SHOP, [id]);
        const buff = await ctx.stub.getState(key);

        return buff !== null && buff.length > 0;
    }

    async customerExists(ctx: Context, id: string) {
        const key = ctx.stub.createCompositeKey(CUSTOMER, [id]);
        const buff = await ctx.stub.getState(key);

        return buff !== null && buff.length > 0;
    }

    async createShop(ctx: Context, id: string, multiplier: number, minPrice: number, maxPoints: number) {
        const shopAlreadyExists = await this.shopExists(ctx, id);
        if(shopAlreadyExists) {
            throw new Error(`Cannot create new shop with ID ${id}, as one like that already exists`);
        }

        const key = ctx.stub.createCompositeKey(SHOP, [id]);
        const shop: Shop = {
            id,
            priceToPointsMultiplier : multiplier,
            minPriceToGetPoints: minPrice,
            maxGivenPoints: maxPoints,
            freePointsPercentage: 1.0
        }
        await ctx.stub.putState(key, this.serialize.shop(shop));

        return { success: "OK", key: key};
    }

    async createCouponType(ctx: Context, shopId: string, kind: string, val: string) {
        const key = ctx.stub.createCompositeKey(COUPONTYPE, [
            shopId, kind, val
        ]);

        // TODO: Ensure that shops can only create a coupon type for themselves
        // TODO: (?) Maybe constraint, what the "kind" can be

        const ct: CouponType = {
            shopId, kind, val, active: true
        }
        
        await ctx.stub.putState(key, Buffer.from(stringify(ct)));

        return { success: "OK" };
    }

    async createCoupon(ctx: Context, idBase: string, typeId: string, owner: string, validUntil: Date, seriesId: string, n: number = 1) {
        // TODO: Ensure that:
        //          1.: The creator must be the shop the type belongs to
        //          2.: Initial owner sould be set automatically to the creator shop

        if(n < 1) {
            throw new Error(`<createCoupon> : Cannot create coupon(s): N (the number of coupons to be created) must be 1 or higher, but instead it was ${n}`);
        }

        const valueBuffer = await ctx.stub.getState(typeId);
        
        if(valueBuffer.length < 1) {
            throw new Error(`<createCoupon> : Cannot create coupon(s): The TypeID "${typeId}" does not exist`);
        }

        const theTypeId: CouponType = JSON.parse(valueBuffer.toString());

        if(!theTypeId.active) {
            throw new Error(`<createCoupon> : Cannot create coupon(s): The coupon type with the ID of "${typeId}" is not currently active`);
        }

        for(var i = 0; i < n; ++i){
            const newCoupon : Coupon = {
                id: `${idBase}_${i}`, typeId, owner, validUntil, seriesId
            }

            const couponKey = ctx.stub.createCompositeKey(COUPON, [newCoupon.id, newCoupon.typeId])
            await ctx.stub.putState(couponKey, Buffer.from(stringify(newCoupon)));
        }

        return { success: "OK", "n": n};
    }

    async createCustomer(ctx: Context, id: string) {
        const customerAlreadyExists = await this.customerExists(ctx, id);
        if(customerAlreadyExists) {
            throw new Error(`<createCustomer> : Cannot create customer with the ID "${id}", as one like that already exists`);
        }

        const key = ctx.stub.createCompositeKey(CUSTOMER, [id]);
        const newCustomer: Customer = {
            id, points: 0.0
        }
        await ctx.stub.putState(key, Buffer.from(stringify(newCustomer)));

        return { success: "OK", newCustomerKey: key }
    }

    async updateCustomer(ctx: Context, c: Customer) {
        const customerAlreadyExists = await this.customerExists(ctx, c.id);
        if(!customerAlreadyExists) {
            throw new Error(`Cannot update customer with ID ${c.id}, because such a customer does not exist yet. Please register first.`)
        }

        const key = ctx.stub.createCompositeKey(CUSTOMER, [c.id])
        await ctx.stub.putState(key, Buffer.from(stringify(c)))

        return { success: "OK" }
    }

    async registerPurchase(ctx: Context, shopId: string, customerId: string, paidAmount: number) {
        const customerAlreadyExists = await this.customerExists(ctx, customerId);
        if(!customerAlreadyExists) {
            throw new Error(`Cannot register purchase, because no customer with the ID "${customerId}" is a member of CryptoLoyality`)
        }

        const shopAlreadyExists = await this.shopExists(ctx, shopId);
        if(!shopAlreadyExists) {
            throw new Error(`Cannot register purchase, because no shop with the ID "${shopId}" is part of the CryptoLoyality program`)
        }

        // TODO: Here I'm constructing the keys again even though they have been already used in the
        //     checks to see if the entities already exist. This could be optimized.
        const shopKey = ctx.stub.createCompositeKey(SHOP, [shopId]);
        const customerKey = ctx.stub.createCompositeKey(CUSTOMER, [customerId]);

        const shopBuffer = await ctx.stub.getState(shopKey);
        const theShop: Shop = JSON.parse(shopBuffer.toString());
        const customerBuffer = await ctx.stub.getState(customerKey);
        let theCustomer: Customer = JSON.parse(customerBuffer.toString());

        // Calculate the points to be given
        let sumPoints = paidAmount * theShop.priceToPointsMultiplier;

        if(paidAmount < theShop.minPriceToGetPoints) {
            return { success: "OK, but no points were given" }
        }

        if(sumPoints > theShop.maxGivenPoints) {
            sumPoints = theShop.maxGivenPoints
        }

        const freePointsToBeGiven = Math.round(sumPoints * theShop.freePointsPercentage)
        const shopSpecificPointsToBeGiven = sumPoints - freePointsToBeGiven

        theCustomer.points += freePointsToBeGiven

        // Register the changes
        this.updateCustomer(ctx, theCustomer);
        // TODO: Also do something with the shop specific (cashback) points

        return { success: "OK" }
    }
}

class CLSerialize {
    public shop(shop: Shop) {
        return Buffer.from(stringify(shop));
    }

    public customer(c: Customer) {
        return Buffer.from(stringify(c));
    }

    public coupon(c: Coupon) {
        return Buffer.from(stringify(c));
    }

    public couponType(ct: CouponType) {
        return Buffer.from(stringify(ct));
    }
}

type Shop = {
    id: string,
    priceToPointsMultiplier: number,
    minPriceToGetPoints: number,
    maxGivenPoints: number,
    // Determines how many of the points given will be "generic" points
    //     The rest will be given as store specific points
    freePointsPercentage: number
}

type Customer = {
    id: string,
    points: number
}

type CouponType = {
    shopId: string,
    kind: string,
    val: string,
    active: boolean
}

type Coupon = {
    id: string,
    typeId: string,
    owner: string,
    validUntil: Date,
    seriesId: string
}


export const contracts = [CryptoLoyality]
