import { Navbar, Welcome, Transactions } from "./components";

const App = () => (
  <div className="min-h-screen">
    <div className="gradient-bg-welcome">
      {/*<Navbar />*/}
      <Welcome />
    </div>
    <Transactions />
  </div>
);

export default App;
