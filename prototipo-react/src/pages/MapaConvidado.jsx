import './MapaConvidado.css';
import { useState } from 'react';

const borracharias = [
  {
    id: 1,
    nome: "Borracharia do João",
    status: "aberto",
    distancia:("1.2 km"),
    telefone: "(64) 99999-0001",
  },
  {
    id: 2,
    nome: "Pneus Silva",
    status: "fechado",
    distancia:("2.5 km"),
    telefone: "(64) 99999-0002",
  },
  {
    id: 3,
    nome: "Borracharia 24h Central",
    status: "aberto",
    distancia:("3.1 km"),
    telefone: "(64) 99999-0003",
  },
];

function MapaConvidado() {
    const [busca, setBusca] = useState("");
    const [somenteAbertas, setSomenteAbertas] = useState(false);
    const [modoSOS, setModoSOS] = useState(false);
    const borrachariasFiltradas = borracharias.filter((borracharia) =>{
      const combinaComBusca = borracharia.nome.toLowerCase().includes(busca.toLowerCase());
      const combinaComStatus = (somenteAbertas || modoSOS) ? borracharia.status === "aberto" : true;
      return combinaComBusca && combinaComStatus;
    }
  );

    const borrachariasParaExibir = modoSOS 
      ? [...borrachariasFiltradas].sort((a,b) => parseFloat(a.distancia) - parseFloat(b.distancia))
      : borrachariasFiltradas;

    return (
        <div className="tela-mapa">
            <h1>Mapa do Convidado</h1>
        <div className="aviso-convidado">
          <p>Você está navegando como convidado. Crie uma conta para avaliar e reportar borracharias.</p>
        </div>
        <input
        type= "text"
        placeholder="Buscar borracharia..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="campo-busca"
        />
        <button
          onClick={() => setSomenteAbertas(!somenteAbertas)}
        className="botao-filtro"
        >
          {somenteAbertas ? "Mostrando : Abertas" : "Mostrar somente abertas"}
        </button>

        <button
          onClick={() => setModoSOS(!modoSOS)}
          className="botao-sos"
        >
          {modoSOS ? "Sair do modo SOS" : "🚨 SOS - Emergência"} 
        </button>


            {borrachariasParaExibir.map((borracharia) =>(
                <div key={borracharia.id} className="borracharia">
                    <h2>{borracharia.nome}</h2>
                    <p className={`status ${borracharia.status === "aberto" ? "status-aberto" : "status-fechado"}`}>
                      {borracharia.status}
                    </p>
                    <p>{borracharia.distancia}</p>
                    <a href={`tel:${borracharia.telefone}`} className="botao-ligar">
                      Ligar Agora
                    </a>
                </div>
            ))}
        </div>
    );
}

export default MapaConvidado;
