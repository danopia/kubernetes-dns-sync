import {
  VultrProviderConfig,
  DnsProvider, DnsProviderContext,
  Zone, Endpoint, Changes,
} from "../../common/mod.ts";
import { VultrApi } from "./api.ts";

// Store metadata on our Endpoints because the API has its own opaque per-target IDs
// TODO: do this a different way (Map on the Context)
type VultrEntry = Endpoint & {
  vultrIds: string[];
  vultrZone: string;
};

export class VultrProvider implements DnsProvider<VultrProviderContext> {
  constructor(
    public config: VultrProviderConfig,
  ) {}
  private api = new VultrApi();

	async NewContext() {
    const zones = new Array<Zone>();
    const domainFilter = new Set(this.config.domain_filter ?? []);
    for await (const {domain} of this.api.listAllZones()) {
      if (domainFilter.size > 0 && !domainFilter.has(domain)) continue;
      zones.push({DNSName: domain, ZoneID: domain});
    }
    return new VultrProviderContext(this.config, zones, this.api);
  }

}
export class VultrProviderContext implements DnsProviderContext {
  constructor(
    public config: VultrProviderConfig,
    public Zones: Array<Zone>,
    private api: VultrApi,
  ) {}

  findZoneForName(dnsName: string): Zone | undefined {
    const matches = this.Zones.filter(x => x.DNSName == dnsName || dnsName.endsWith('.'+x.DNSName));
    return matches.sort((a,b) => b.DNSName.length - a.DNSName.length)[0];
  }

  async Records(): Promise<Endpoint[]> {
    const endpoints = new Array<Endpoint>(); // every recordset we find
    for (const zone of this.Zones) {

      const endpMap = new Map<string, VultrEntry>(); // collapse targets with same name/type/priority
      for await (const record of this.api.listAllRecords(zone.DNSName)) {

        const priority = (record.type === 'MX' || record.type === 'SRV') ? record.priority : null;
        const dnsName = record.name ? `${record.name}.${zone.DNSName}` : zone.DNSName;
        const mapKey = [record.name, record.type, priority].join(':');
        const target = record.type === 'TXT' ? record.data.slice(1, -1) : record.data; // any others?

        const existingEndp = endpMap.get(mapKey);
        if (existingEndp) {
          existingEndp.Targets.push(target);
          existingEndp.vultrIds.push(record.id);
        } else {
          const endp: VultrEntry = {
            DNSName: dnsName,
            RecordType: record.type,
            Targets: [target],
            RecordTTL: record.ttl >= 0 ? record.ttl : undefined,
            Priority: priority ?? undefined,
            vultrIds: [record.id],
            vultrZone: zone.DNSName,
            SplitOutTarget,
          };
          endpoints.push(endp);
          endpMap.set(mapKey, endp);
        }

      }
    }
    return endpoints;
  }

  async ApplyChanges(changes: Changes): Promise<void> {

    for (const deleted of changes.Delete as VultrEntry[]) {
      if (!deleted.vultrIds || deleted.vultrIds.length !== deleted.Targets.length) throw new Error(`BUG`);
      for (const id of deleted.vultrIds) {
        await this.api.deleteRecord(deleted.vultrZone, id);
      }
    }

    for (const [before, after] of changes.Update as Array<[VultrEntry, Endpoint]>) {
      const zone = before.vultrZone;
      // TODO: be more efficient with updating-in-place
      for (const recordId of before.vultrIds) {
        await this.api.deleteRecord(zone, recordId);
      }
      for (const target of after.Targets) {
        await this.api.createRecord(zone, {
          name: after.DNSName == zone ? '' : after.DNSName.slice(0, -zone.length - 1),
          type: after.RecordType,
          data: after.RecordType === 'TXT' ? `"${target}"` : target,
          ttl: after.RecordTTL ?? undefined,
          priority: after.Priority ?? undefined,
        });
      }
    }

    for (const created of changes.Create) {
      const zone = this.findZoneForName(created.DNSName);
      if (!zone) continue;

      for (const target of created.Targets) {
        await this.api.createRecord(zone.ZoneID, {
          name: created.DNSName.slice(0, -zone.DNSName.length - 1),
          type: created.RecordType,
          data: created.RecordType === 'TXT' ? `"${target}"` : target,
          ttl: created.RecordTTL ?? undefined,
          priority: created.Priority ?? undefined,
        });
      }
    }

  }

}

/// Support splitting records and still keeping vultrIds
export function SplitOutTarget(this: VultrEntry, predicate: (t: string) => boolean): [VultrEntry, VultrEntry] {
  const idxs = new Set(this.Targets.flatMap((x, idx) => predicate(x) ? [idx] : []));
  return [{
    ...this,
    Targets: this.Targets.flatMap((x, idx) => idxs.has(idx) ? [x] : []),
    vultrIds: this.vultrIds.flatMap((x, idx) => idxs.has(idx) ? [x] : []),
  }, {
    ...this,
    Targets: this.Targets.flatMap((x, idx) => idxs.has(idx) ? [] : [x]),
    vultrIds: this.vultrIds.flatMap((x, idx) => idxs.has(idx) ? [] : [x]),
  }];
}
