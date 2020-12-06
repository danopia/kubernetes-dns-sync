export interface DnsProvider {
	Records(): Promise<Array<Endpoint>>;
	ApplyChanges(changes: Changes): Promise<void>;
}

// Source defines the interface Endpoint sources should implement.
export interface DnsSource {
	Endpoints(): Promise<Array<Endpoint>>;
	// AddEventHandler adds an event handler that should be triggered if something in source changes
	AddEventHandler(cb: () => void): void;
}

export interface DnsRegistry<T extends DnsRegistryContext> {
	NewContext(): T;
}
export interface DnsRegistryContext {
	RecognizeLabels(raw: Array<Endpoint>): Promise<Array<Endpoint>>;
	CommitLabels(changes: Changes): Promise<Changes>;
}

/** Endpoint is a high-level way of a connection between a service and an IP */
export interface Endpoint {
	/** The hostname of the DNS record */
	DNSName: string;
	/** The targets the DNS record points to */
	Targets: Array<string>;
	/** RecordType type of record, e.g. CNAME, A, SRV, TXT etc */
	RecordType: string;
	/** TTL for the record */
  RecordTTL?: number;
	/** Labels stores labels defined for the Endpoint */
  Labels?: Record<string,string>;

  /** Priority for MX or SRV records */
  Priority?: number;
	/** Identifier to distinguish multiple records with the same name and type (e.g. Route53 records with routing policies other than 'simple') */
	SetIdentifier?: string;
  /** Kubernetes annotations useful for filtering */
  Annotations?: Record<string,string>;

	/** ProviderSpecific stores provider specific config */
	ProviderSpecific?: Array<ProviderSpecificProperty>;

	SplitOutTarget(predicate: (t: string) => boolean): [Endpoint, Endpoint];
}

/** ProviderSpecificProperty holds the name and value of a configuration which is specific to individual DNS providers */
export interface ProviderSpecificProperty {
	Name:  string;
	Value: string;
}

/** Changes holds lists of actions to be executed by dns providers */
export class Changes {
	constructor(
		public sourceRecords: Endpoint[],
		public existingRecords: Endpoint[],
	) {}

	/** Records that need to be created */
	Create = new Array<Endpoint>();
	/** Records that need to be updated (current data, desired data) */
	Update = new Array<[Endpoint,Endpoint]>();
	/** Records that need to be deleted */
	Delete = new Array<Endpoint>();

	length() {
		return this.Create.length + this.Update.length + this.Delete.length;
	}

	summary() {
		return [
			this.Create.length, 'creates,',
			this.Update.length, 'updates,',
			this.Delete.length, 'deletes'];
	}
}
