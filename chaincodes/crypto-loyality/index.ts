import { Context, Contract } from 'fabric-contract-api'
import stringify from 'json-stringify-deterministic'

const COUPONTYPE = "COUPONTYPE";
const COUPON = "COUPON";
const SHOP = "SHOP";
const CUSTOMER = "CUSTOMER";
const SHOP_SPECIFIC_TOKEN = "SHOP_SPECIFIC_TOKEN";
const USER = "USER";

async function entityExists(ctx: Context, key: string) {
    const buff = await ctx.stub.getState(key);

    return buff !== null && buff.length > 0;
}

async function shopExists(ctx: Context, id: string) {
    const key = ctx.stub.createCompositeKey(SHOP, [id]);
    const buff = await ctx.stub.getState(key);

    return buff !== null && buff.length > 0;
}

async function customerExists(ctx: Context, id: string) {
    const key = ctx.stub.createCompositeKey(CUSTOMER, [id]);
    const buff = await ctx.stub.getState(key);

    return buff !== null && buff.length > 0;
}

async function shopSpecificTokenExists(ctx: Context, shopId: string, customerId: string) {
    const key = ctx.stub.createCompositeKey(SHOP_SPECIFIC_TOKEN, [shopId, customerId]);
    const buff = await ctx.stub.getState(key);

    return buff !== null && buff.length > 0;
}

export class CryptoLoyality extends Contract {
    serialize = new CLSerialize();
    keygen = new CLKeyGen();
    get = new CLGetter();

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

    async register(ctx: Context, id: string, uRole: string) {
        const clientId = ctx.clientIdentity.getID();
        const userKey = this.keygen.user(ctx, clientId);

        if(await entityExists(ctx, userKey)) {
            error(
                "register",
                `Cannot register new user, because a registration for the requesting client already exists\n---[ Client info ]---\n${clientId}`
            )
        }

        const role = userRoleFromString(uRole)
        if(role == null) {
            error(
                "register",
                `Invalid input for User Role: "${uRole}"`
            )
            return // Just because the linter doesn't seem to be clever enough to discover that the error function will thor
        }

        const newUser: User = {
            id, role
        }

        ctx.stub.putState(userKey, this.serialize.user(newUser));

        return { success: "OK", key: userKey }
    }

    async createShopSpecificToken(ctx: Context, shopId: string, customerId: string) {
        const sstKey = ctx.stub.createCompositeKey(SHOP_SPECIFIC_TOKEN, [shopId, customerId]);

        if(await entityExists(ctx, sstKey)) {
            throw new Error(`<createShopSpecificToken> : Cannot create Shop Specific Token where the shop is "${shopId}" and the customer is "${customerId}", because one like that already exists`)
        }

        if(! await shopExists(ctx, shopId)) {
            throw new Error(`<createShopSpecificToken> : Cannot create shop specifc token, because no shop with ID "${shopId}" exists`)
        }

        if(! await customerExists(ctx, customerId)) {
            error(
                "createShopSpecificToken",
                `Cannot create shop specifc token, because no customer with ID "${customerId}" exists`
            )
        }

        const newSST: ShopSpecificToken = {
            shopId, customerId, amount: 0.0
        }
        
        await ctx.stub.putState(sstKey, this.serialize.sst(newSST));

        return { success: "OK", key: sstKey }
    }

    async increaseShopSpecificToken(ctx: Context, shopId: string, customerId: string, addAmount: number) {
        const key = this.keygen.sst(ctx, shopId, customerId);

        if(! await entityExists(ctx, key)) {
            error(
                "increaseShopSpecificToken",
                `Cannot update the Shop Specific Token where the shop is "${shopId}" and the customer is "${customerId}", because no such token exists yet`
            )
        }

        let theToken = await this.get.sst(ctx, shopId, customerId);
        theToken.amount += addAmount;

        await ctx.stub.putState(key, this.serialize.sst(theToken));

        return { success: "OK" }
    }

    async createShop(ctx: Context, id: string, multiplier: number, minPrice: number, maxPoints: number) {
        const shopAlreadyExists = await shopExists(ctx, id);
        if(shopAlreadyExists) {
            throw new Error(`Cannot create new shop with ID ${id}, as one like that already exists`);
        }

        const key = this.keygen.shop(ctx, id)
        const shop: Shop = {
            id,
            priceToPointsMultiplier : multiplier,
            minPriceToGetPoints: minPrice,
            maxGivenPoints: maxPoints,
            freePointsPercentage: 1.0
        }
        await ctx.stub.putState(key, this.serialize.shop(shop));

        return { success: "OK", key: key };
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
        
        await ctx.stub.putState(key, this.serialize.couponType(ct));

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
            await ctx.stub.putState(couponKey, this.serialize.coupon(newCoupon));
        }

        return { success: "OK", "n": n };
    }

    async createCustomer(ctx: Context, id: string) {
        const customerAlreadyExists = await customerExists(ctx, id);
        if(customerAlreadyExists) {
            throw new Error(`<createCustomer> : Cannot create customer with the ID "${id}", as one like that already exists`);
        }

        const key = this.keygen.customer(ctx, id);
        const newCustomer: Customer = {
            id, points: 0.0
        }
        await ctx.stub.putState(key, this.serialize.customer(newCustomer));

        return { success: "OK", newCustomerKey: key }
    }

    async updateCustomer(ctx: Context, c: Customer) {
        const customerAlreadyExists = await customerExists(ctx, c.id);
        if(!customerAlreadyExists) {
            throw new Error(`Cannot update customer with ID ${c.id}, because such a customer does not exist yet. Please register first.`)
        }

        const key = this.keygen.customer(ctx, c.id)
        await ctx.stub.putState(key, this.serialize.customer(c))

        return { success: "OK" }
    }

    async registerPurchase(ctx: Context, shopId: string, customerId: string, paidAmount: number) {
        const customerAlreadyExists = await customerExists(ctx, customerId);
        if(!customerAlreadyExists) {
            throw new Error(`Cannot register purchase, because no customer with the ID "${customerId}" is a member of CryptoLoyality`)
        }

        const shopAlreadyExists = await shopExists(ctx, shopId);
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
        // If the customer does not yet have specific tokens for this shop, we create one
        if(! await shopSpecificTokenExists(ctx, shopId, customerId)) {
            this.createShopSpecificToken(ctx, shopId, customerId);
        }
        await this.increaseShopSpecificToken(ctx, shopId, customerId, shopSpecificPointsToBeGiven)

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

    public sst(s: ShopSpecificToken) {
        return Buffer.from(stringify(s));
    }

    public user(u: User) {
        return Buffer.from(stringify(u));
    }
}

class CLKeyGen {
    public sst(ctx: Context, shopId: string, customerId: string) {
        return ctx.stub.createCompositeKey(SHOP_SPECIFIC_TOKEN, [shopId, customerId])
    }

    public couponType(ctx: Context, shopId: string, kind: string, val: string) {
        return ctx.stub.createCompositeKey(COUPONTYPE, [ shopId, kind, val ])
    }

    public user(ctx: Context, clientId: string) {
        return ctx.stub.createCompositeKey(USER, [clientId]);
    }

    public shop(ctx: Context, id: string) {
        return ctx.stub.createCompositeKey(SHOP, [id]);
    }

    public customer(ctx: Context, id: string) {
        return ctx.stub.createCompositeKey(CUSTOMER, [id]);
    }
}

class CLGetter {
    private keygen = new CLKeyGen();

    async sst(ctx: Context, shopId: string, customerId: string) {
        const key = this.keygen.sst(ctx, shopId, customerId);

        if(! await entityExists(ctx, key)) {
            error(
                "Getter :: SST",
                `No Shop Specific Token exists where the shop is "${shopId}" and the customer is "${customerId}"`
            )
        }

        const buff = await ctx.stub.getState(key);
        const theSST: ShopSpecificToken = JSON.parse(buff.toString());

        return theSST;
    }

    async couponType(ctx: Context, shopId: string, kind: string, val: string) {
        const key = this.keygen.couponType(ctx, shopId, kind, val)
        
        if(! await entityExists(ctx, key)) {
            error(
                "GET :: Coupon Type",
                `There is no CouponType where the shop is "${shopId}", kind is "${kind}" and value is "${val}"`
            )
        }

        const buff = await ctx.stub.getState(key);
        const theCouponType: CouponType = JSON.parse(buff.toString());

        return theCouponType;
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

function error(methodName: string, msg: string) {
    throw new Error(`<${methodName}> : ${msg}`)
}

function userRoleFromString(type: string) {
    switch(type) {
        case UserRole.Admin:
            return UserRole.Admin
        case UserRole.Shop:
            return UserRole.Shop
        case UserRole.Customer:
            return UserRole.Customer
        default:
            return null;
    }
}

enum UserRole {
    Admin = "admin",
    Shop = "shop",
    Customer = "customer"
}

type User = {
    id: string,
    role: UserRole
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

type ShopSpecificToken = {
    shopId: string,
    customerId: string,
    amount: number
}


export const contracts = [CryptoLoyality]
