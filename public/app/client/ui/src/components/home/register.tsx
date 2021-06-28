import React from "react";
import { Component } from "@ui_types";
import * as styles from "@styles";
import { Link } from "react-router-dom";
import { HomeContainer } from "./home_container";

export const RegisterChooseOrgType: Component = (props) => {
  return (
    <HomeContainer>
      <div>
        <h3>
          Sign up and get working immediately with <strong>EnvKey Cloud</strong>
          .
          <br />
          Or <strong>deploy your own</strong> auto-scaling, geographically
          distributed EnvKey on AWS.
        </h3>
      </div>
      <div className={styles.HomeMenu}>
        <ul className="primary">
          <li>
            <Link to={"/register-cloud"}>
              <input type="radio" onClick={(e) => e.preventDefault()} />
              EnvKey Cloud
            </Link>
          </li>
          <li>
            <Link to={"/register-self-hosted"}>
              <input type="radio" onClick={(e) => e.preventDefault()} />
              Self-Hosted
            </Link>
          </li>
        </ul>
      </div>
      <div className={styles.SelectAccount}>
        <div className="home-link">
          <Link to="/home">← Back To Home</Link>
        </div>
      </div>
    </HomeContainer>
  );
};
