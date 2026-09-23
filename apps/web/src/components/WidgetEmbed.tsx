import Script from "next/script";
import { API_URL, WIDGET_KEY, WIDGET_URL } from "@/lib/config";

// The actual embed snippet a university would add to its site: one <script> tag carrying the widget key. Loaded
// after the page is interactive (strategy="afterInteractive") so it never blocks First Contentful Paint.
export function WidgetEmbed() {
  return (
    <Script
      src={`${WIDGET_URL}/loader.js`}
      data-widget-key={WIDGET_KEY}
      data-api={API_URL}
      data-widget-origin={WIDGET_URL}
      strategy="afterInteractive"
    />
  );
}
