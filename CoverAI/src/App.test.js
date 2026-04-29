import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders CoverAI branding", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /start coverai/i })).toBeInTheDocument();
  expect(screen.getByText(/ai workbench/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /redo/i })).toBeInTheDocument();
});
