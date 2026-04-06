"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

type EventData = {
  id: string;
  name: string;
  emoji: string;
  spent: number;
  budget: number;
  transactionCount: number;
  transactions: { id: string; merchant: string; amount: number; date: string }[];
};

const EMOJI_OPTIONS = [
  "🎄", "🎂", "🏖️", "🎓", "🏠", "💒", "🎃", "🎆", "✈️", "🎁",
];

const SAMPLE_EVENTS: EventData[] = [
  {
    id: "evt_1",
    name: "Holiday Shopping",
    emoji: "🎄",
    spent: 450,
    budget: 1000,
    transactionCount: 12,
    transactions: [
      { id: "t1", merchant: "Amazon", amount: 89.99, date: "2025-12-15" },
      { id: "t2", merchant: "Target", amount: 156.32, date: "2025-12-18" },
      { id: "t3", merchant: "Best Buy", amount: 203.69, date: "2025-12-20" },
    ],
  },
  {
    id: "evt_2",
    name: "Birthday Party",
    emoji: "🎂",
    spent: 125,
    budget: 300,
    transactionCount: 5,
    transactions: [
      { id: "t4", merchant: "Party City", amount: 45.0, date: "2026-02-10" },
      { id: "t5", merchant: "Costco Bakery", amount: 39.99, date: "2026-02-12" },
      { id: "t6", merchant: "DoorDash", amount: 40.01, date: "2026-02-14" },
    ],
  },
  {
    id: "evt_3",
    name: "Summer Trip",
    emoji: "🏖️",
    spent: 890,
    budget: 2000,
    transactionCount: 18,
    transactions: [
      { id: "t7", merchant: "Delta Airlines", amount: 342.0, date: "2026-06-01" },
      { id: "t8", merchant: "Hilton Hotels", amount: 289.0, date: "2026-06-05" },
      { id: "t9", merchant: "Uber", amount: 67.5, date: "2026-06-06" },
      { id: "t10", merchant: "Restaurant Row", amount: 191.5, date: "2026-06-07" },
    ],
  },
];

export default function EventsPage() {
  const [events, setEvents] = useState<EventData[]>(SAMPLE_EVENTS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventData | null>(null);

  // New event form state
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🎁");
  const [newBudget, setNewBudget] = useState("");

  const handleCreateEvent = () => {
    if (!newName.trim() || !newBudget) return;

    const event: EventData = {
      id: `evt_${Date.now()}`,
      name: newName.trim(),
      emoji: newEmoji,
      spent: 0,
      budget: parseFloat(newBudget),
      transactionCount: 0,
      transactions: [],
    };

    setEvents((prev) => [...prev, event]);
    setNewName("");
    setNewEmoji("🎁");
    setNewBudget("");
    setDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Events</h1>
          <p className="text-muted-foreground">
            Track spending for life events and special occasions.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button>
                <Plus className="size-4" />
                New Event
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Event</DialogTitle>
              <DialogDescription>
                Set up a new event to group and track related spending.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Emoji</Label>
                <div className="grid grid-cols-5 gap-2">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setNewEmoji(emoji)}
                      className={cn(
                        "flex size-10 items-center justify-center rounded-lg border text-xl transition-colors hover:bg-muted",
                        newEmoji === emoji &&
                          "border-primary bg-primary/10 ring-2 ring-primary/20"
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-name">Event Name</Label>
                <Input
                  id="event-name"
                  placeholder="e.g. Holiday Shopping"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-budget">Budget</Label>
                <Input
                  id="event-budget"
                  type="number"
                  step="0.01"
                  placeholder="1000.00"
                  value={newBudget}
                  onChange={(e) => setNewBudget(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreateEvent}
                disabled={!newName.trim() || !newBudget}
              >
                Create Event
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Event grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {events.map((event) => {
          const utilization = Math.min(
            (event.spent / event.budget) * 100,
            100
          );
          const isOver = event.spent > event.budget;

          return (
            <Sheet
              key={event.id}
              open={selectedEvent?.id === event.id}
              onOpenChange={(open) =>
                setSelectedEvent(open ? event : null)
              }
            >
              <SheetTrigger
                render={
                  <button
                    type="button"
                    className="text-left w-full"
                  >
                    <Card className="h-full cursor-pointer transition-shadow hover:ring-2 hover:ring-primary/20">
                      <CardContent className="space-y-3 pt-1">
                        <span className="text-4xl" role="img" aria-label={event.name}>
                          {event.emoji}
                        </span>
                        <div>
                          <CardTitle className="truncate">{event.name}</CardTitle>
                          <p className="text-2xl font-bold font-mono mt-1">
                            {formatCurrency(event.spent)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            of {formatCurrency(event.budget)} budget
                          </p>
                        </div>
                        <Progress value={utilization}>
                          <ProgressLabel className="sr-only">
                            Budget utilization
                          </ProgressLabel>
                          <ProgressValue>
                            {() => `${Math.round(utilization)}%`}
                          </ProgressValue>
                        </Progress>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={isOver ? "destructive" : "secondary"}
                          >
                            {event.transactionCount} transactions
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                }
              />
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>
                    {event.emoji} {event.name}
                  </SheetTitle>
                  <SheetDescription>
                    Budget: {formatCurrency(event.budget)} &middot; Spent:{" "}
                    {formatCurrency(event.spent)} &middot;{" "}
                    {formatCurrency(event.budget - event.spent)} remaining
                  </SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-auto px-4">
                  <div className="mb-4">
                    <Progress value={utilization}>
                      <ProgressLabel>Budget used</ProgressLabel>
                      <ProgressValue>
                        {() => `${Math.round(utilization)}%`}
                      </ProgressValue>
                    </Progress>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Linked Transactions
                    </h3>
                    {event.transactions.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No transactions linked yet.
                      </p>
                    ) : (
                      event.transactions.map((txn) => (
                        <div
                          key={txn.id}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div>
                            <p className="text-sm font-medium">
                              {txn.merchant}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {txn.date}
                            </p>
                          </div>
                          <span className="font-mono text-sm font-medium">
                            {formatCurrency(txn.amount)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          );
        })}
      </div>
    </div>
  );
}
