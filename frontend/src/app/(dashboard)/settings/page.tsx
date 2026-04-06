"use client";

import { useState, useRef, useCallback } from "react";
import { cn, API_URL, formatCurrency } from "@/lib/utils";
import { useGetAccounts, type Account } from "@/features/accounts/api/use-get-accounts";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  LinkIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
  UploadIcon,
  BotIcon,
  UserIcon,
  SparklesIcon,
  Loader2Icon,
  WalletIcon,
  BuildingIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TELLER_APP_ID = process.env.NEXT_PUBLIC_TELLER_APP_ID || "";
const TELLER_ENV = process.env.NEXT_PUBLIC_TELLER_ENV || "sandbox";

const DEFAULT_CATEGORIES = [
  { emoji: "\uD83C\uDF54", name: "Food" },
  { emoji: "\uD83D\uDE97", name: "Transport" },
  { emoji: "\uD83D\uDED2", name: "Groceries" },
  { emoji: "\uD83C\uDFE0", name: "Housing" },
  { emoji: "\uD83D\uDC8A", name: "Health" },
  { emoji: "\uD83C\uDFAE", name: "Entertainment" },
  { emoji: "\u2708\uFE0F", name: "Travel" },
  { emoji: "\uD83D\uDCB0", name: "Income" },
  { emoji: "\uD83D\uDCE6", name: "Shopping" },
];

const EMOJI_GRID = [
  "\uD83C\uDF54", "\uD83D\uDE97", "\uD83D\uDED2", "\uD83C\uDFE0", "\uD83D\uDC8A",
  "\uD83C\uDFAE", "\u2708\uFE0F", "\uD83D\uDCB0", "\uD83D\uDCE6", "\uD83C\uDF7D\uFE0F",
  "\u2615", "\uD83C\uDFCB\uFE0F", "\uD83D\uDCDA", "\uD83C\uDFB5", "\uD83D\uDC55",
  "\uD83D\uDCBB", "\uD83C\uDF81", "\uD83D\uDEBF", "\u26FD", "\uD83C\uDF93",
  "\uD83C\uDFE5", "\uD83D\uDCF1", "\uD83C\uDFAC", "\uD83C\uDF89", "\uD83D\uDECD\uFE0F",
  "\uD83D\uDE8C", "\uD83D\uDE95", "\uD83C\uDFE8", "\uD83D\uDC88", "\u26BD",
  "\uD83C\uDFA8", "\uD83C\uDF3F",
];

// ---------------------------------------------------------------------------
// Connections Tab
// ---------------------------------------------------------------------------

function ConnectionsTab() {
  const { data: accounts, isLoading: accountsLoading, refetch } = useGetAccounts();
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // -- Teller Connect --
  const handleTellerConnect = useCallback(() => {
    const loadAndOpen = () => {
      const teller = (window as any).TellerConnect.setup({
        applicationId: TELLER_APP_ID,
        environment: TELLER_ENV,
        onSuccess: async (enrollment: any) => {
          try {
            const res = await fetch(
              `${API_URL}/api/ingestion/connect/teller?access_token=${encodeURIComponent(enrollment.accessToken)}`,
              { method: "POST" }
            );
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.detail || `${res.status}`);
            }
            toast.success("Bank connected successfully");
            refetch();
          } catch (e: any) {
            toast.error(e.message || "Failed to connect bank");
          }
        },
        onFailure: (failure: any) => {
          toast.error(`Teller Connect failed: ${failure.message || "Unknown error"}`);
        },
        onExit: () => {},
      });
      teller.open();
    };

    if (!(window as any).TellerConnect) {
      const script = document.createElement("script");
      script.src = "https://cdn.teller.io/connect/connect.js";
      script.onload = loadAndOpen;
      document.head.appendChild(script);
    } else {
      loadAndOpen();
    }
  }, [refetch]);

  // -- Manual token fetch --
  const handleManualFetch = async () => {
    if (!accessToken.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/ingestion/connect/teller?access_token=${encodeURIComponent(accessToken.trim())}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `${res.status}`);
      }
      toast.success("Accounts fetched successfully");
      setAccessToken("");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Failed to fetch accounts");
    } finally {
      setLoading(false);
    }
  };

  // -- CSV upload --
  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API_URL}/api/ingestion/upload/csv`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `${res.status}`);
      }
      toast.success("CSV uploaded successfully");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Failed to upload CSV");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      {/* Connected Accounts */}
      <Card>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
          <CardDescription>
            Bank accounts synced with CashLens
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accountsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading accounts...
            </div>
          ) : accounts && accounts.length > 0 ? (
            <div className="space-y-3">
              {accounts.map((acct) => (
                <div
                  key={acct.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-muted">
                      <BuildingIcon className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{acct.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {acct.institution_name}
                        {acct.mask && <> &middot; ****{acct.mask}</>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {acct.balance_current && (
                      <span className="text-sm font-mono">
                        {formatCurrency(Number(acct.balance_current))}
                      </span>
                    )}
                    <Badge variant="secondary">
                      {acct.account_subtype || acct.account_type || "Account"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No accounts connected yet. Use the options below to get started.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Connect New */}
      <Card>
        <CardHeader>
          <CardTitle>Connect New</CardTitle>
          <CardDescription>
            Link a bank account or upload transaction data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quick connect buttons */}
          <div className="flex flex-wrap gap-2">
            {TELLER_APP_ID ? (
              <Button onClick={handleTellerConnect}>
                <LinkIcon className="size-4" data-icon="inline-start" />
                Connect with Teller
              </Button>
            ) : (
              <Button disabled>
                <LinkIcon className="size-4" data-icon="inline-start" />
                Connect with Teller
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                toast.info("SimpleFIN integration coming soon")
              }
            >
              Connect SimpleFIN
            </Button>
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
            >
              <UploadIcon className="size-4" data-icon="inline-start" />
              Upload CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCSVUpload}
            />
          </div>

          {!TELLER_APP_ID && (
            <p className="text-xs text-muted-foreground">
              Set NEXT_PUBLIC_TELLER_APP_ID in .env to enable Teller Connect
            </p>
          )}

          <Separator />

          {/* Manual token input */}
          <div className="space-y-2">
            <Label>Manual Access Token</Label>
            <p className="text-xs text-muted-foreground">
              Paste a Teller access token directly (sandbox:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                test_token_ky6igyqi3qxa4
              </code>
              )
            </p>
            <div className="flex gap-2">
              <Input
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="test_token_ky6igyqi3qxa4"
                className="flex-1"
              />
              <Button
                onClick={handleManualFetch}
                disabled={!accessToken.trim() || loading}
                variant="outline"
              >
                {loading ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  "Fetch"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories Tab
// ---------------------------------------------------------------------------

type Category = { emoji: string; name: string };

function CategoriesTab() {
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("\uD83D\uDCCC");

  const handleAdd = () => {
    if (!newName.trim()) return;
    setCategories((prev) => [...prev, { emoji: newEmoji, name: newName.trim() }]);
    setNewName("");
    setNewEmoji("\uD83D\uDCCC");
    setDialogOpen(false);
    toast.success(`Category "${newName.trim()}" added`);
  };

  const handleDelete = (name: string) => {
    setCategories((prev) => prev.filter((c) => c.name !== name));
    toast.success(`Category "${name}" removed`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Transaction Categories</CardTitle>
          <CardDescription>
            Manage categories used to classify your transactions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {categories.map((cat) => (
            <div
              key={cat.name}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{cat.emoji}</span>
                <span className="text-sm font-medium">{cat.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => toast.info("Edit coming soon")}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  variant="destructive"
                  size="icon-sm"
                  onClick={() => handleDelete(cat.name)}
                >
                  <TrashIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button variant="outline" className="mt-2 w-full">
                  <PlusIcon className="size-4" data-icon="inline-start" />
                  Add Category
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Category</DialogTitle>
                <DialogDescription>
                  Choose an emoji and name for the new category.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Emoji picker grid */}
                <div>
                  <Label className="mb-2">Emoji</Label>
                  <div className="grid grid-cols-8 gap-1">
                    {EMOJI_GRID.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setNewEmoji(e)}
                        className={cn(
                          "flex size-8 items-center justify-center rounded-md text-base transition-colors hover:bg-muted",
                          newEmoji === e && "bg-primary/10 ring-1 ring-primary"
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="cat-name" className="mb-1.5">
                    Name
                  </Label>
                  <Input
                    id="cat-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Subscriptions"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAdd();
                    }}
                  />
                </div>
              </div>

              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button onClick={handleAdd} disabled={!newName.trim()}>
                  Add Category
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Tab
// ---------------------------------------------------------------------------

const TOKEN_USAGE = [
  { label: "Categorization", tokens: 12400, pct: 45 },
  { label: "Chat queries", tokens: 8200, pct: 30 },
  { label: "Summaries", tokens: 4100, pct: 15 },
  { label: "Other", tokens: 2700, pct: 10 },
];

function AITab() {
  const [model, setModel] = useState("auto");

  return (
    <div className="space-y-6">
      {/* Model selection */}
      <Card>
        <CardHeader>
          <CardTitle>AI Model</CardTitle>
          <CardDescription>
            Choose which model CashLens uses for categorization and chat
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Label className="min-w-20">Model</Label>
            <Select value={model} onValueChange={(v) => { if (v) setModel(v); }}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (recommended)</SelectItem>
                <SelectItem value="gpt-4o-mini">gpt-4o-mini</SelectItem>
                <SelectItem value="gemini-flash">gemini-flash</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Usage */}
      <Card>
        <CardHeader>
          <CardTitle>Usage This Month</CardTitle>
          <CardDescription>
            Estimated cost and token breakdown
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">$2.34</span>
            <span className="text-sm text-muted-foreground">this month</span>
          </div>

          <div className="space-y-4">
            {TOKEN_USAGE.map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span>{item.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {item.tokens.toLocaleString()} tokens
                  </span>
                </div>
                <Progress value={item.pct} />
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total tokens</span>
            <span className="font-medium tabular-nums">
              {TOKEN_USAGE.reduce((s, i) => s + i.tokens, 0).toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile Tab
// ---------------------------------------------------------------------------

function ProfileTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Manage your account settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <UserIcon className="size-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Profile settings coming soon</p>
              <p className="text-xs text-muted-foreground">
                You'll be able to manage your name, email, and preferences here.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage connections, categories, AI preferences, and your profile.
        </p>
      </div>

      <Tabs defaultValue="connections">
        <TabsList>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
        </TabsList>

        <TabsContent value="connections">
          <ConnectionsTab />
        </TabsContent>

        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>

        <TabsContent value="ai">
          <AITab />
        </TabsContent>

        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
