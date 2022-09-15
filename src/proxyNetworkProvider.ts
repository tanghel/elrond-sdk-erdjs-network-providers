import axios, { AxiosRequestConfig } from "axios";
import { AccountOnNetwork } from "./accounts";
import { IAddress, IContractQuery, INetworkProvider, IPagination, ITransaction } from "./interface";
import { NetworkConfig } from "./networkConfig";
import { NetworkStake } from "./networkStake";
import { NetworkGeneralStatistics } from "./networkGeneralStatistics";
import { FungibleTokenOfAccountOnNetwork, NonFungibleTokenOfAccountOnNetwork } from "./tokens";
import { TransactionOnNetwork } from "./transactions";
import { TransactionStatus } from "./transactionStatus";
import { ErrContractQuery, ErrNetworkProvider } from "./errors";
import { defaultAxiosConfig } from "./config";
import { NetworkStatus } from "./networkStatus";
import { ContractQueryResponse } from "./contractQueryResponse";
import { DefinitionOfFungibleTokenOnNetwork, DefinitionOfTokenCollectionOnNetwork } from "./tokenDefinitions";
import { ContractQueryRequest } from "./contractQueryRequest";
import { EsdtContractAddress } from "./constants";

// TODO: Find & remove duplicate code between "ProxyNetworkProvider" and "ApiNetworkProvider".
export class ProxyNetworkProvider implements INetworkProvider {
    private url: string;
    private config: AxiosRequestConfig;

    constructor(url: string, config?: AxiosRequestConfig) {
        this.url = url;
        this.config = { ...defaultAxiosConfig, ...config };
    }

    async getNetworkConfig(): Promise<NetworkConfig> {
        let response = await this.doGetGeneric("network/config");
        let networkConfig = NetworkConfig.fromHttpResponse(response.config);
        return networkConfig;
    }

    async getNetworkStatus(): Promise<NetworkStatus> {
        let response = await this.doGetGeneric("network/status/4294967295");
        let networkStatus = NetworkStatus.fromHttpResponse(response.status);
        return networkStatus;
    }

    async getNetworkStakeStatistics(): Promise<NetworkStake> {
        // TODO: Implement wrt.:
        // https://github.com/ElrondNetwork/api.elrond.com/blob/main/src/endpoints/stake/stake.service.ts
        throw new Error("Method not implemented.");
    }

    async getNetworkGeneralStatistics(): Promise<NetworkGeneralStatistics> {
        // TODO: Implement wrt. (full implementation may not be possible):
        // https://github.com/ElrondNetwork/api.elrond.com/blob/main/src/endpoints/network/network.service.ts
        throw new Error("Method not implemented.");
    }

    async getAccount(address: IAddress): Promise<AccountOnNetwork> {
        let response = await this.doGetGeneric(`address/${address.bech32()}`);
        let account = AccountOnNetwork.fromHttpResponse(response.account);
        return account;
    }

    async getFungibleTokensOfAccount(address: IAddress, _pagination?: IPagination): Promise<FungibleTokenOfAccountOnNetwork[]> {
        let url = `address/${address.bech32()}/esdt`;
        let response = await this.doGetGeneric(url);
        let responseItems: any[] = Object.values(response.esdts);
        // Skip NFTs / SFTs.
        let responseItemsFiltered = responseItems.filter(item => !item.nonce);
        let tokens = responseItemsFiltered.map(item => FungibleTokenOfAccountOnNetwork.fromHttpResponse(item));

        // TODO: Fix sorting
        tokens.sort((a, b) => a.identifier.localeCompare(b.identifier));
        return tokens;
    }

    async getNonFungibleTokensOfAccount(address: IAddress, _pagination?: IPagination): Promise<NonFungibleTokenOfAccountOnNetwork[]> {
        let url = `address/${address.bech32()}/esdt`;
        let response = await this.doGetGeneric(url);
        let responseItems: any[] = Object.values(response.esdts);
        // Skip fungible tokens.
        let responseItemsFiltered = responseItems.filter(item => item.nonce >= 0);
        let tokens = responseItemsFiltered.map(item => NonFungibleTokenOfAccountOnNetwork.fromProxyHttpResponse(item));

        // TODO: Fix sorting
        tokens.sort((a, b) => a.identifier.localeCompare(b.identifier));
        return tokens;
    }

    async getFungibleTokenOfAccount(address: IAddress, tokenIdentifier: string): Promise<FungibleTokenOfAccountOnNetwork> {
        let response = await this.doGetGeneric(`address/${address.bech32()}/esdt/${tokenIdentifier}`);
        let tokenData = FungibleTokenOfAccountOnNetwork.fromHttpResponse(response.tokenData);
        return tokenData;
    }

    async getNonFungibleTokenOfAccount(address: IAddress, collection: string, nonce: number): Promise<NonFungibleTokenOfAccountOnNetwork> {
        let response = await this.doGetGeneric(`address/${address.bech32()}/nft/${collection}/nonce/${nonce.valueOf()}`);
        let tokenData = NonFungibleTokenOfAccountOnNetwork.fromProxyHttpResponseByNonce(response.tokenData);
        return tokenData;
    }

    async getTransaction(txHash: string): Promise<TransactionOnNetwork> {
        let url = this.buildUrlWithQueryParameters(`transaction/${txHash}`, { withResults: "true" });
        let response = await this.doGetGeneric(url);
        let transaction = TransactionOnNetwork.fromProxyHttpResponse(txHash, response.transaction);
        return transaction;
    }

    async getTransactionStatus(txHash: string): Promise<TransactionStatus> {
        let response = await this.doGetGeneric(`transaction/${txHash}/status`);
        let status = new TransactionStatus(response.status);
        return status;
    }

    async sendTransaction(tx: ITransaction): Promise<string> {
        let response = await this.doPostGeneric("transaction/send", tx.toSendable());
        return response.txHash;
    }

    async simulateTransaction(tx: ITransaction): Promise<any> {
        let response = await this.doPostGeneric("transaction/simulate", tx.toSendable());
        return response;
    }

    async queryContract(query: IContractQuery): Promise<ContractQueryResponse> {
        try {
            let request = new ContractQueryRequest(query).toHttpRequest();
            let response = await this.doPostGeneric("vm-values/query", request);
            return ContractQueryResponse.fromHttpResponse(response.data);
        } catch (error: any) {
            throw new ErrContractQuery(error);
        }
    }

    async getDefinitionOfFungibleToken(tokenIdentifier: string): Promise<DefinitionOfFungibleTokenOnNetwork> {
        let properties = await this.getTokenProperties(tokenIdentifier);
        let definition = DefinitionOfFungibleTokenOnNetwork.fromResponseOfGetTokenProperties(tokenIdentifier, properties);
        return definition;
    }

    private async getTokenProperties(identifier: string): Promise<Buffer[]> {
        let encodedIdentifier = Buffer.from(identifier).toString("hex");

        let queryResponse = await this.queryContract({
            address: EsdtContractAddress,
            func: "getTokenProperties",
            getEncodedArguments: () => [encodedIdentifier]
        });

        let properties = queryResponse.getReturnDataParts();
        return properties;
    }

    async getDefinitionOfTokenCollection(collection: string): Promise<DefinitionOfTokenCollectionOnNetwork> {
        let properties = await this.getTokenProperties(collection);
        let definition = DefinitionOfTokenCollectionOnNetwork.fromResponseOfGetTokenProperties(collection, properties);
        return definition;
    }

    async getNonFungibleToken(_collection: string, _nonce: number): Promise<NonFungibleTokenOfAccountOnNetwork> {
        throw new Error("Method not implemented.");
    }

    async doGetGeneric(resourceUrl: string): Promise<any> {
        let response = await this.doGet(resourceUrl);
        return response;
    }

    async doPostGeneric(resourceUrl: string, payload: any): Promise<any> {
        let response = await this.doPost(resourceUrl, payload);
        return response;
    }

    private async doGet(resourceUrl: string): Promise<any> {
        let url = `${this.url}/${resourceUrl}`;

        try {
            let response = await axios.get(url, this.config);
            let payload = response.data.data;
            return payload;
        } catch (error) {
            this.handleApiError(error, resourceUrl);
        }
    }

    private async doPost(resourceUrl: string, payload: any): Promise<any> {
        let url = `${this.url}/${resourceUrl}`;

        try {
            let response = await axios.post(url, payload, {
                ...this.config,
                headers: {
                    "Content-Type": "application/json",
                    ...this.config.headers,
                },
            });
            let responsePayload = response.data.data;
            return responsePayload;
        } catch (error) {
            this.handleApiError(error, resourceUrl);
        }
    }

    private buildUrlWithQueryParameters(endpoint: string, params: Record<string, string>): string {
        let searchParams = new URLSearchParams();

        for (let [key, value] of Object.entries(params)) {
            if (value) {
                searchParams.append(key, value);
            }
        }

        return `${endpoint}?${searchParams.toString()}`;
    }

    private handleApiError(error: any, resourceUrl: string) {
        if (!error.response) {
            throw new ErrNetworkProvider(resourceUrl, error.toString(), error);
        }

        let errorData = error.response.data;
        let originalErrorMessage = errorData.error || errorData.message || JSON.stringify(errorData);
        throw new ErrNetworkProvider(resourceUrl, originalErrorMessage, error);
    }
}

