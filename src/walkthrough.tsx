import ReactDOM from "react-dom/client";
import Walkthrough from "./app/pages/Walkthrough";
import { ThemeContext, useDarkMode } from "./app/theme";
import { ToastProvider } from "./app/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./app.css";

function App() {
  const themeValue = useDarkMode();

  return (
    <ThemeContext.Provider value={themeValue}>
      <TooltipProvider>
        <ToastProvider>
          <Walkthrough />
        </ToastProvider>
      </TooltipProvider>
    </ThemeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
