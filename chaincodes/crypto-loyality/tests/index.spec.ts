import chai, { expect } from "chai";
import { Context } from "fabric-contract-api";
import { ChaincodeStub, ClientIdentity } from "fabric-shim";
import sinon, { SinonStubbedInstance } from "sinon"
import { CryptoLoyality } from "..";

class ContextMock implements Context {
    stub: SinonStubbedInstance<ChaincodeStub>
    clientIdentity: SinonStubbedInstance<ClientIdentity>
    logging: {
        setLevel: (level: string) => void;
        getLogger: (name?: string) => any;
    }

    constructor() {
        this.stub = sinon.createStubInstance(ChaincodeStub)
        this.clientIdentity = sinon.createStubInstance(ClientIdentity)
        this.logging = {
            setLevel: sinon.stub(),
            getLogger: sinon.stub()
        }
    }
}

describe("Register customer", () => {
    let contract = new CryptoLoyality();
    let ctx = new ContextMock();

    beforeEach(() => {
        it("should register a new customer and also a user corresponding to it", async () => {
            await contract.registerCustomer(ctx, "TestCustomer1");

            expect(ctx.stub.putState.calledTwice)
        })
    })
})

