"use client";

import { useState, useRef, useCallback } from "react";
import { Camera, Upload, Loader2, X, Check, AlertCircle } from "lucide-react";
import { cn, formatCurrency, API_URL } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";

type LineItem = {
  description: string;
  amount: number;
};

type OcrResult = {
  merchant: string;
  date: string;
  total: number;
  line_items: LineItem[];
};

type CandidateTransaction = {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  account: string;
};

type PageState = "idle" | "uploading" | "results" | "error";

const MOCK_CANDIDATES: CandidateTransaction[] = [
  {
    id: "txn_1",
    merchant: "Whole Foods Market",
    amount: -87.43,
    date: "2026-04-04",
    account: "Chase Checking",
  },
  {
    id: "txn_2",
    merchant: "Whole Foods",
    amount: -87.43,
    date: "2026-04-03",
    account: "Amex Blue",
  },
  {
    id: "txn_3",
    merchant: "WFM #10432",
    amount: -92.1,
    date: "2026-04-04",
    account: "Chase Checking",
  },
];

export default function ScannerPage() {
  const [state, setState] = useState<PageState>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedTxn, setSelectedTxn] = useState<string>("");
  const [editedResult, setEditedResult] = useState<OcrResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(file);

      setState("uploading");
      setErrorMessage("");

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`${API_URL}/api/ingestion/scan/receipt`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          throw new Error(`Upload failed (${res.status})`);
        }

        const data: OcrResult = await res.json();
        setOcrResult(data);
        setEditedResult(data);
        setState("results");
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Something went wrong"
        );
        setState("error");
      }
    },
    []
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) handleFileSelect(files[0]);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files && files[0]) handleFileSelect(files[0]);
    },
    [handleFileSelect]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const updateField = (field: keyof OcrResult, value: string | number) => {
    if (!editedResult) return;
    setEditedResult({ ...editedResult, [field]: value });
  };

  const updateLineItem = (
    index: number,
    field: keyof LineItem,
    value: string | number
  ) => {
    if (!editedResult) return;
    const items = [...editedResult.line_items];
    items[index] = { ...items[index], [field]: value };
    setEditedResult({ ...editedResult, line_items: items });
  };

  const resetScanner = () => {
    setState("idle");
    setPreview(null);
    setOcrResult(null);
    setEditedResult(null);
    setSelectedTxn("");
    setErrorMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = () => {
    // TODO: POST confirmed match to backend
    resetScanner();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Receipt Scanner</h1>
        <p className="text-muted-foreground">
          Snap or upload a receipt to match it with a bank transaction.
        </p>
      </div>

      {/* Hidden native file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleInputChange}
      />

      {/* Idle: Dropzone */}
      {state === "idle" && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="flex w-full flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-12 text-center transition-colors hover:border-primary/50 hover:bg-muted/50 active:scale-[0.99]"
        >
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Camera className="size-8 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-medium">
              Tap to scan or drop a receipt
            </p>
            <p className="text-sm text-muted-foreground">
              Supports JPG, PNG, HEIC up to 10MB
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Upload className="size-3.5" />
            <span>or drag and drop</span>
          </div>
        </button>
      )}

      {/* Uploading: Spinner */}
      {state === "uploading" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            {preview && (
              <img
                src={preview}
                alt="Receipt preview"
                className="max-h-48 rounded-lg object-contain opacity-60"
              />
            )}
            <Loader2 className="size-8 animate-spin text-primary" />
            <div className="space-y-1 text-center">
              <p className="font-medium">Processing receipt...</p>
              <p className="text-sm text-muted-foreground">
                Extracting merchant, date, and line items
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {state === "error" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            {preview && (
              <img
                src={preview}
                alt="Receipt preview"
                className="max-h-48 rounded-lg object-contain opacity-40"
              />
            )}
            <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="size-6 text-destructive" />
            </div>
            <div className="space-y-1 text-center">
              <p className="font-medium">Scan failed</p>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
            <Button variant="outline" onClick={resetScanner}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Results: Editable form + match */}
      {state === "results" && editedResult && (
        <>
          {/* Preview strip */}
          {preview && (
            <div className="relative">
              <img
                src={preview}
                alt="Receipt"
                className="max-h-40 w-full rounded-xl object-contain bg-muted"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm"
                onClick={resetScanner}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}

          {/* OCR Results */}
          <Card>
            <CardHeader>
              <CardTitle>Extracted Details</CardTitle>
              <CardDescription>
                Review and correct the scanned information.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="merchant">Merchant</Label>
                  <Input
                    id="merchant"
                    value={editedResult.merchant}
                    onChange={(e) => updateField("merchant", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={editedResult.date}
                    onChange={(e) => updateField("date", e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="total">Total</Label>
                <Input
                  id="total"
                  type="number"
                  step="0.01"
                  value={editedResult.total}
                  onChange={(e) =>
                    updateField("total", parseFloat(e.target.value) || 0)
                  }
                />
              </div>

              {editedResult.line_items.length > 0 && (
                <div className="space-y-3">
                  <Label>Line Items</Label>
                  <div className="space-y-2">
                    {editedResult.line_items.map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          className="flex-1"
                          placeholder="Description"
                          value={item.description}
                          onChange={(e) =>
                            updateLineItem(i, "description", e.target.value)
                          }
                        />
                        <Input
                          className="w-24"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={item.amount}
                          onChange={(e) =>
                            updateLineItem(
                              i,
                              "amount",
                              parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Match to Transaction */}
          <Card>
            <CardHeader>
              <CardTitle>Match to Transaction</CardTitle>
              <CardDescription>
                Select the bank transaction that matches this receipt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={selectedTxn}
                onValueChange={setSelectedTxn}
                className="space-y-2"
              >
                {MOCK_CANDIDATES.map((txn) => (
                  <label
                    key={txn.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50",
                      selectedTxn === txn.id &&
                        "border-primary bg-primary/5"
                    )}
                  >
                    <RadioGroupItem value={txn.id} />
                    <div className="flex flex-1 items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{txn.merchant}</p>
                        <p className="text-xs text-muted-foreground">
                          {txn.date} &middot; {txn.account}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 font-mono">
                        {formatCurrency(Math.abs(txn.amount))}
                      </Badge>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <Button variant="outline" onClick={resetScanner}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!selectedTxn}>
                <Check className="size-4" />
                Confirm Match
              </Button>
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  );
}
