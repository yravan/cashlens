import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockUsePlaidLinkContext = vi.fn();

vi.mock("@/components/plaid-link-provider", () => ({
  usePlaidLinkContext: () => mockUsePlaidLinkContext(),
}));

import { PlaidConnectButton } from "@/components/plaid-connect-button";

describe("PlaidConnectButton", () => {
  it("renders the sandbox guidance when live sandbox mode is active", () => {
    const connect = vi.fn();
    mockUsePlaidLinkContext.mockReturnValue({
      connect,
      environment: "sandbox",
      errorMessage: null,
      mode: "live",
      pending: false,
      ready: true,
    });

    render(<PlaidConnectButton />);

    expect(screen.getByTestId("plaid-connect-button")).toHaveTextContent("Connect with Plaid");
    expect(screen.getByText(/415-555-0010/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("plaid-connect-button"));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("shows launch copy and inline errors without depending on layout", () => {
    mockUsePlaidLinkContext.mockReturnValue({
      connect: vi.fn(),
      environment: "production",
      errorMessage: "Plaid could not initialize. Refresh and try again.",
      mode: "live",
      pending: false,
      ready: false,
    });

    render(<PlaidConnectButton />);

    expect(screen.getByTestId("plaid-connect-button")).toHaveTextContent("Launch Plaid");
    expect(screen.getByText(/could not initialize/i)).toBeVisible();
  });
});
