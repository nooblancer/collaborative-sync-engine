import AnimateOnScroll from "@/components/landing/animate-on-scroll";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

const properties = [
  { number: 1, name: "Commutativity", explanation: "Operations can be applied in any order and produce the same result" },
  { number: 2, name: "Associativity", explanation: "Grouping of operations does not affect the final result" },
  { number: 3, name: "Idempotency", explanation: "Applying the same operation multiple times has no additional effect" },
  { number: 4, name: "Convergence", explanation: "All replicas eventually reach the same state" },
  { number: 5, name: "Causal Ordering", explanation: "Operations respect causal dependencies via HLC timestamps" },
  { number: 6, name: "Last-Writer-Wins", explanation: "Concurrent conflicts resolve deterministically by timestamp" },
  { number: 7, name: "Monotonic Clock", explanation: "HLC timestamps always increase across operations" },
  { number: 8, name: "Bounded Drift", explanation: "Physical clock drift is bounded and detectable" },
  { number: 9, name: "Add Uniqueness", explanation: "Each add operation creates a unique item identity" },
  { number: 10, name: "Remove Semantics", explanation: "Removes are tombstoned, preserving history" },
  { number: 11, name: "Update Atomicity", explanation: "Field updates are applied atomically" },
  { number: 12, name: "Delta Minimality", explanation: "Only changed fields are included in state deltas" },
  { number: 13, name: "Delta Completeness", explanation: "All changes from an operation appear in the delta" },
  { number: 14, name: "Merge Determinism", explanation: "Same inputs always produce the same merged state" },
  { number: 15, name: "State Validity", explanation: "Merged state always satisfies invariants (non-negative qty, valid names)" },
  { number: 16, name: "Operation Integrity", explanation: "Operations are validated before processing" },
  { number: 17, name: "Offline Accumulation", explanation: "Operations queue correctly during disconnection" },
  { number: 18, name: "Reconnection Sync", explanation: "Queued operations replay correctly after reconnection" },
  { number: 19, name: "Concurrent Safety", explanation: "Concurrent operations from multiple clients merge safely" },
  { number: 20, name: "Snapshot Consistency", explanation: "Snapshots reflect a valid point-in-time state" },
  { number: 21, name: "Ordering Preservation", explanation: "Operation order is preserved within each client's stream" },
];

export default function PropertiesSection() {
  return (
    <section id="properties" className="px-4 sm:px-6 lg:px-8 py-20">
      <div className="max-w-5xl mx-auto">
        <AnimateOnScroll>
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Verified CRDT Properties
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              All 21 properties verified through property-based testing using fast-check
            </p>
          </div>
        </AnimateOnScroll>

        <AnimateOnScroll delay={0.1}>
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead className="w-48">Property</TableHead>
                  <TableHead>Explanation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((prop) => (
                  <TableRow key={prop.number}>
                    <TableCell className="font-mono text-muted-foreground">
                      {prop.number}
                    </TableCell>
                    <TableCell className="font-medium">{prop.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {prop.explanation}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </AnimateOnScroll>
      </div>
    </section>
  );
}
