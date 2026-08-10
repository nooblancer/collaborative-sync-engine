import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./table";

describe("Table", () => {
  it("renders a semantic table element", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders table header with thead element", () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Item</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(container.querySelector("thead")).toBeInTheDocument();
  });

  it("renders table body with tbody element", () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Content</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(container.querySelector("tbody")).toBeInTheDocument();
  });

  it("renders rows and cells with correct content", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Quantity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Widget</TableCell>
            <TableCell>42</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Gadget</TableCell>
            <TableCell>7</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Quantity")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Gadget")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders th elements for table heads", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const th = screen.getByText("Header");
    expect(th.tagName).toBe("TH");
  });

  it("renders td elements for table cells", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Data</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const td = screen.getByText("Data");
    expect(td.tagName).toBe("TD");
  });

  it("applies custom className to table components", () => {
    const { container } = render(
      <Table className="custom-table">
        <TableHeader className="custom-header">
          <TableRow className="custom-row">
            <TableHead className="custom-head">H</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="custom-body">
          <TableRow>
            <TableCell className="custom-cell">C</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    expect(container.querySelector("table")).toHaveClass("custom-table");
    expect(container.querySelector("thead")).toHaveClass("custom-header");
    expect(container.querySelector("tbody")).toHaveClass("custom-body");
    expect(screen.getByText("H")).toHaveClass("custom-head");
    expect(screen.getByText("C")).toHaveClass("custom-cell");
  });

  it("renders rows with border and hover styling", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Styled row</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const row = screen.getByText("Styled row").closest("tr");
    expect(row).toHaveClass("border-b", "border-border", "hover:bg-muted/50");
  });
});
