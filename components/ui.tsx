import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";

const inputClass =
  "block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm " +
  "text-stone-900 placeholder:text-stone-400 shadow-sm " +
  "focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 " +
  "disabled:cursor-not-allowed disabled:bg-stone-100";

export function Field({
  label,
  htmlFor,
  error,
  children,
  ...rest
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  children: ReactNode;
} & LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-stone-700"
        {...rest}
      >
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput(
  props: InputHTMLAttributes<HTMLInputElement>,
) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function PrimaryButton({
  children,
  ...rest
}: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={
        "inline-flex w-full items-center justify-center rounded-lg bg-teal-700 px-4 py-2.5 " +
        "text-sm font-semibold text-white shadow-sm transition-colors " +
        "hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-stone-300 " +
        `disabled:text-stone-500 ${rest.className ?? ""}`
      }
    >
      {children}
    </button>
  );
}

export function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-stone-600">{description}</p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles =
    kind === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : kind === "success"
        ? "border-teal-200 bg-teal-50 text-teal-900"
        : "border-stone-200 bg-stone-100 text-stone-700";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2.5 text-sm ${styles}`}>
      {children}
    </div>
  );
}
